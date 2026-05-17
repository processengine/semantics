# @processengine/semantics v2 — Нормативная спецификация Flow 5

## Что нормативно определяет этот документ

Нормативная спецификация `@processengine/semantics v2`.

Определяет:
- Таксономию шагов Flow 5 и DSL-контракт
- Контракт process state (ProcessContext, ProcessState)
- Публичный API: validateFlow, prepareFlow, createProcessState, plan, reduce, apply, resume
- Runtime-семантику для каждого типа шага
- Коды ошибок и диагностических сообщений

## Таксономия шагов Flow 5

| Шаг | Subtype | Назначение |
|-----|---------|-----------|
| PROCESS | DATA | Синхронная обработка данных через dataflow artifact |
| CONTROL | ROUTE | Маршрутизация по скалярному значению из state |
| EFFECT | COMMAND, CALL, SUBFLOW | Асинхронный внешний вызов или запуск subflow |
| WAIT | MESSAGE | Ожидание ответа на EFFECT |
| TERMINAL | COMPLETE, FAIL | Завершение процесса |

**Удалено в Flow 5 (не поддерживается):**
- `PROCESS/RULES`, `PROCESS/MAPPINGS`, `PROCESS/DECISIONS` → заменены на `PROCESS/DATA`
- `CONTROL/SWITCH`, `factRef` → заменены на `CONTROL/ROUTE` с полем `ref`

## ProcessContext (Flow 5)

```ts
interface ProcessContext {
  input: Record<string, unknown>;        // входные данные процесса
  data: {
    payloads:  Record<string, unknown>;  // промежуточные payload между системами
    facts:     Record<string, unknown>;  // decision-ready признаки ситуации
    decisions: Record<string, unknown>;  // принятые решения из dataflow
    checks:    Record<string, unknown>;  // результаты rule-проверок
    results:   Record<string, unknown>;  // результаты для TERMINAL.resultRef
  };
  effects: Record<string, unknown>;      // ответы внешних систем (EFFECT/WAIT)
  steps:   Record<string, StepRuntimeState>; // trace only
}
```

**Удалены из Flow 5:** `context.facts`, `context.decisions`, `context.checks` — использовать `context.data.*`.

## ProcessState (Flow 5)

```ts
interface ProcessState {
  processId:          string;
  flowId:             string;   // в v1 было 'id'
  flowVersion:        string;   // в v1 было 'version'
  status:             'ACTIVE' | 'WAITING' | 'COMPLETE' | 'FAIL';
  currentStepId:      string;
  currentStepType:    string;
  currentStepSubtype: string;
  context:            ProcessContext;
  history:            ProcessHistoryEntry[];
  result:             TerminalResult | null;
  meta:               JsonObject;
  traceMode:          'off' | 'basic' | 'verbose';
}
```

## Определения шагов

### PROCESS/DATA

```ts
{
  id:          string;   // обязательно
  type:        'PROCESS';
  subtype:     'DATA';
  title:       string;   // обязательно
  description: string;   // обязательно
  artefactId:  string;   // обязательно — ID dataflow artifact
  nextStepId:  string;   // обязательно
  metadata?:   JsonObject;
}
```

**Запрещённые поля:** `contract`, `inputRef`, `outputRef`, `cases`, `onErrorStepId`.

`PROCESS/DATA` не владеет контрактом данных. Контракт данных принадлежит dataflow artifact.

### CONTROL/ROUTE

```ts
{
  id:              string;
  type:            'CONTROL';
  subtype:         'ROUTE';
  title:           string;
  description:     string;
  ref:             string;                 // PathRef на скалярное значение в state
  cases:           Record<string, string>; // значение → nextStepId
  defaultNextStepId: string;
  metadata?:       JsonObject;
}
```

Поведение `ref`:
- Путь отсутствует в state → `FLOW_ROUTE_REF_NOT_RESOLVED` (runtime error)
- Путь указывает на object/array → `FLOW_ROUTE_REF_NOT_SCALAR` (runtime error)
- Нет совпадения в cases → `defaultNextStepId`

### EFFECT (COMMAND, CALL, SUBFLOW)

```ts
{
  id:              string;
  type:            'EFFECT';
  subtype:         'COMMAND' | 'CALL' | 'SUBFLOW';
  title:           string;
  description:     string;
  operationId:     string;   // обязательно
  inputRef:        string;   // обязательно — только строковый PathRef
  nextStepId:      string;   // обязательно
  onErrorStepId:   string;   // обязательно — сбой внешней системы это lifecycle outcome
  onTimeoutStepId?: string;
  // Только для SUBFLOW:
  flowId?:         string;
  flowVersion?:    string;
  metadata?:       JsonObject;
}
```

### WAIT/MESSAGE

```ts
{
  id:              string;
  type:            'WAIT';
  subtype:         'MESSAGE';
  title:           string;
  description:     string;
  sourceStepId:    string;   // обязательно — должен ссылаться на EFFECT шаг
  nextStepId:      string;
  onErrorStepId:   string;
  onTimeoutStepId: string;
  metadata?:       JsonObject;
}
```

### TERMINAL (COMPLETE, FAIL)

```ts
{
  id:          string;
  type:        'TERMINAL';
  subtype:     'COMPLETE' | 'FAIL';
  title:       string;
  description: string;
  // ровно одно из result или resultRef:
  result?:     { status: 'COMPLETE'|'FAIL'; outcome: string; [k: string]: JsonValue };
  resultRef?:  string; // должен начинаться с $.context.data.results.
  metadata?:   JsonObject;
}
```

`result.status` должен совпадать с `subtype`. `resultRef` должен указывать в `$.context.data.results.*`.

## Публичный API

```ts
validateFlow(source, options?) → ValidationResult
prepareFlow(source, options?)  → PreparedFlow        // throws XCompileError если невалидно
createProcessState(params)     → ProcessState
plan(flow, state)              → NormalizedStep
reduce(step, state, output)    → ProcessState
apply(flow, state, stepId, effectResult) → ProcessState
resume(flow, state, stepId, waitResult)  → ProcessState
```

## Runtime-семантика

### plan

Возвращает нормализованный шаг для текущего состояния. State не мутирует.

Для `PROCESS/DATA`:
```ts
{ id, type: 'PROCESS', subtype: 'DATA', artefactId, nextStepId }
// Нет input — orchestrator не видит внутренности dataflow
```

Для `CONTROL/ROUTE`:
```ts
{ id, type: 'CONTROL', subtype: 'ROUTE', selectedNextStepId }
// Резолвит ref и выбирает case внутри
```

### reduce

```
reduce(PROCESS/DATA, state, DataflowOutput) → ProcessState
  DataflowOutput = { writes: DataflowWrite[], trace?: unknown[] }
  Каждый write.ref должен начинаться с $.context.data.
  Каждый write.value должен быть JSON-safe
  writes применяются атомарно к context.data.*
  После применения — переход на nextStepId

reduce(CONTROL/ROUTE, state, null) → ProcessState
  Переходит на selectedNextStepId

reduce(TERMINAL, state, null) → ProcessState
  static result → устанавливает state.status, state.result
  resultRef → резолвит из context.data.results.*, проверяет shape, устанавливает state.status, state.result
  Возвращает финализированный terminal state

```

## Коды диагностики валидации

| Код | Когда возникает |
|-----|----------------|
| `FLOW_INVALID_SUBTYPE` | PROCESS/RULES, MAPPINGS, DECISIONS, CONTROL/SWITCH |
| `FLOW_DATA_STEP_FORBIDDEN_FIELD` | contract/inputRef/cases/onErrorStepId на DATA шаге |
| `FLOW_ROUTE_FACTREF_REMOVED` | factRef на ROUTE шаге |
| `FLOW_EFFECT_ON_ERROR_MISSING` | EFFECT без onErrorStepId |
| `FLOW_TRANSITION_NOT_FOUND` | nextStepId/case/default ссылается на несуществующий шаг |
| `FLOW_WAIT_SOURCE_NOT_EFFECT` | WAIT.sourceStepId не является EFFECT шагом |
| `FLOW_TERMINAL_RESULT_STATUS_MISMATCH` | result.status ≠ subtype (COMPLETE/FAIL) |
| `FLOW_TERMINAL_RESULTREF_INVALID` | resultRef не в $.context.data.results.* |
| `FLOW_METADATA_INVALID` | metadata — не JSON-safe plain object |

## Коды runtime ошибок

| Код | Когда возникает |
|-----|----------------|
| `FLOW_ROUTE_REF_NOT_RESOLVED` | ref путь отсутствует в state |
| `FLOW_ROUTE_REF_NOT_SCALAR` | ref указывает на object/array |
| `FLOW_DATA_OUTPUT_INVALID` | DataflowOutput не { writes: array } |
| `FLOW_DATA_WRITE_FORBIDDEN_PATH` | write.ref не в $.context.data.* |
| `FLOW_DATA_WRITE_NOT_JSON_SAFE` | write.value не JSON-safe |
| `FLOW_TERMINAL_MISUSED` | runtime method вызван на уже-terminal state |
| `FLOW_RESULT_REF_NOT_RESOLVED` | resultRef путь отсутствует в state |
| `FLOW_RESULT_REF_SHAPE_INVALID` | значение по resultRef имеет неверный shape |
| `FLOW_RUNTIME_INPUT_INVALID` | невалидный аргумент публичного API |
