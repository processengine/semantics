# @processengine/semantics v3 — нормативная спецификация Flow 5 State v2

Этот документ задает публичный контракт `@processengine/semantics v3`: DSL Flow 5, runtime state v2, lifecycle API, переходы и стабильные коды диагностик.

## Таксономия Шагов

| Шаг | Subtype | Назначение |
|-----|---------|------------|
| `PROCESS` | `DATA` | Синхронная бизнес-оценка через dataflow artifact |
| `CONTROL` | `ROUTE` | Маршрутизация по скалярному значению из `$.data.*` |
| `EFFECT` | `COMMAND`, `CALL`, `SUBFLOW` | Внешний вызов или запуск дочернего процесса |
| `WAIT` | `MESSAGE` | Ожидание асинхронного результата EFFECT |
| `TERMINAL` | `COMPLETE`, `FAIL` | Завершение процесса |

Удалено из Flow 5: `PROCESS/RULES`, `PROCESS/MAPPINGS`, `PROCESS/DECISIONS`, `CONTROL/SWITCH`, `CONTROL/ROUTE.factRef`.

## State v2

```ts
interface ProcessState {
  processId: string;
  flowId: string;
  flowVersion: string;
  stateVersion: 'flow5-state-v2';
  traceMode: 'off' | 'basic' | 'verbose';
  status: 'ACTIVE' | 'WAITING' | 'COMPLETE' | 'FAIL';
  current: {
    stepId: string;
    type: 'PROCESS' | 'CONTROL' | 'EFFECT' | 'WAIT' | 'TERMINAL';
    subtype: string;
  };
  input: Record<string, unknown>;
  data: {
    payloads: Record<string, unknown>;
    facts: Record<string, unknown>;
    decisions: Record<string, unknown>;
    checks: Record<string, unknown>;
    results: Record<string, unknown>;
  };
  steps: Record<string, StepRuntimeState>;
  timeline: TimelineEntry[];
  result: TerminalResult | null;
  meta: JsonObject;
}
```

State v2 не хранит legacy runtime-зоны `context`, `history`, `context.effects` и runtime-проекции `waitResult`. Доменные поля с именем `waitResult` внутри `input` или `data` не запрещаются по имени. Исполнения EFFECT лежат в `steps.<effectStepId>.executions[]`. Виртуальный сегмент `latest` резолвится через `latestExecutionId`, например `$.steps.send_create_client.latest.command.result`.

`traceMode: 'off'` не отключает минимальные `steps` и `timeline`; он управляет только детализацией trace-представления. Значения `PROCESS/DATA` write остаются в `dataflow.writes[]` для аудита даже в режимах `off` и `basic`; `verbose` добавляет расширенные input/trace-детали там, где они поддержаны.

## Определения Шагов

### PROCESS/DATA

```ts
{
  id: string;
  type: 'PROCESS';
  subtype: 'DATA';
  title: string;
  description: string;
  artefactId: string;
  nextStepId: string;
  metadata?: JsonObject;
}
```

Запрещены поля `contract`, `inputRef`, `outputRef`, `cases`, `onErrorStepId`, `onTimeoutStepId`.

Контракт данных принадлежит dataflow artifact, а не flow-шагу.

### CONTROL/ROUTE

```ts
{
  id: string;
  type: 'CONTROL';
  subtype: 'ROUTE';
  title: string;
  description: string;
  ref: string; // должен начинаться с $.data.
  cases: Record<string, string>;
  defaultNextStepId: string;
  metadata?: JsonObject;
}
```

Поведение:

- путь отсутствует -> `FLOW_ROUTE_REF_NOT_RESOLVED`;
- значение object/array -> `FLOW_ROUTE_REF_NOT_SCALAR`;
- нет совпадения в `cases` -> `defaultNextStepId`.

### EFFECT

```ts
{
  id: string;
  type: 'EFFECT';
  subtype: 'COMMAND' | 'CALL' | 'SUBFLOW';
  title: string;
  description: string;
  operationId: string;
  inputRef: string; // $.input* или $.data*
  nextStepId: string;
  onErrorStepId: string;
  onTimeoutStepId?: string;
  flowId?: string;      // только SUBFLOW, обязательно для SUBFLOW
  flowVersion?: string; // только SUBFLOW, обязательно для SUBFLOW
  metadata?: JsonObject;
}
```

`COMMAND` и `SUBFLOW` могут переходить в `WAIT/MESSAGE` для асинхронного завершения. `CALL` синхронный: он должен завершаться внутри `apply(...)` и не должен переходить в `WAIT/MESSAGE`.

### WAIT/MESSAGE

```ts
{
  id: string;
  type: 'WAIT';
  subtype: 'MESSAGE';
  title: string;
  description: string;
  sourceStepId: string; // должен ссылаться на EFFECT
  nextStepId: string;
  onErrorStepId: string;
  onTimeoutStepId: string;
  metadata?: JsonObject;
}
```

`resume(...)` принимает transient `ResumeEvent`; событие не сохраняется как `waitResult`.

### TERMINAL

```ts
{
  id: string;
  type: 'TERMINAL';
  subtype: 'COMPLETE' | 'FAIL';
  title: string;
  description: string;
  result?: { status: 'COMPLETE' | 'FAIL'; outcome: string; [k: string]: JsonValue };
  resultRef?: string; // должен начинаться с $.data.results.
  metadata?: JsonObject;
}
```

Нужно ровно одно поле из `result` или `resultRef`. `result.status` должен совпадать с `subtype`.

## Публичный API

```ts
validateFlow(source, options?) -> ValidationResult
prepareFlow(source, options?) -> PreparedFlow
createProcessState(params) -> ProcessState
plan(flow, state) -> NormalizedStep
reduce(step, state, output) -> ProcessState
apply(flow, state, stepId, effectResult) -> ProcessState
resume(flow, state, stepId, resumeEvent) -> ProcessState
```

## Runtime-Семантика

`plan(...)` возвращает нормализованный текущий шаг и не мутирует state.

`reduce(PROCESS/DATA, state, DataflowOutput)`:

- атомарно применяет `DataflowOutput.writes[]`;
- каждый `write.ref` должен начинаться с `$.data.`;
- каждый `write.value` должен быть JSON-safe;
- переводит процесс на `nextStepId`.

`reduce(CONTROL/ROUTE, state, null)` переводит процесс на выбранный переход.

`apply(EFFECT, ...)` записывает исполнение command/subflow в `steps.<effectStepId>.executions[]`. Если следующий шаг `COMMAND` или `SUBFLOW` — WAIT, исполнение остается в статусе `WAITING` до `resume(...)`.

`resume(WAIT, ...)` прикрепляет transient resume event к latest execution исходного EFFECT, записывает исполнение WAIT и переходит по success/error/timeout.

`reduce(TERMINAL, ...)` финализирует процесс по статическому `result` или `resultRef` из `$.data.results.*`.

## Канонический Post-WAIT Bridge

Только первый `PROCESS/DATA` сразу после `WAIT/MESSAGE` может читать результат исходного EFFECT через:

```text
$.steps.<sourceEffectStepId>.latest.command.*
$.steps.<sourceEffectStepId>.latest.subflow.*
```

Этот bridge-шаг обязан нормализовать внешний ответ в `$.data.*`. Все последующие DATA, ROUTE, EFFECT и TERMINAL читают уже нормализованные `$.data.*` или вход процесса.

## Ключевые Диагностики

| Код | Когда возникает |
|-----|-----------------|
| `FLOW_INVALID_SUBTYPE` | удаленный Flow 3 subtype |
| `FLOW_DATA_STEP_FORBIDDEN_FIELD` | DATA-шаг содержит запрещенные поля контракта |
| `FLOW_ROUTE_FACTREF_REMOVED` | `factRef` на ROUTE |
| `FLOW_ROUTE_REF_INVALID` | ROUTE ref вне `$.data.*` |
| `FLOW_EFFECT_INPUT_INVALID` | EFFECT inputRef вне `$.input*` / `$.data*` |
| `FLOW_EFFECT_ON_ERROR_MISSING` | EFFECT без `onErrorStepId` |
| `FLOW_WAIT_SOURCE_NOT_EFFECT` | WAIT source не EFFECT |
| `FLOW_TERMINAL_RESULTREF_INVALID` | resultRef вне `$.data.results.*` |
| `FLOW_DATA_WRITE_FORBIDDEN_PATH` | DATA write вне `$.data.*` |
| `FLOW_CONTEXT_FORBIDDEN` | в State v2 runtime передан State v1 `context` |
| `FLOW_CONTEXT_EFFECTS_FORBIDDEN` | найден сохраненный `context.effects` |
| `FLOW_WAIT_RESULT_PERSISTED_FORBIDDEN` | найдена сохраненная runtime-проекция `waitResult` |
