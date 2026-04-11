# `@processengine/semantics` — Спецификация

**Версия:** 1.0.0  
**DSL:** Flow3  
**Роль:** семантический слой семейства ProcessEngine

---

## 1. Назначение

`semantics` — движок смысла процесса в семействе ProcessEngine. Интерпретирует **Flow3** — каноническую декларативную DSL-форму описания процессов — и обеспечивает transport-safe, детерминированные переходы состояния процесса.

`semantics` владеет: валидацией и подготовкой DSL, `plan(...)`, `reduce(...)`, `apply(...)`, `resume(...)`, канонической формой состояния процесса, внутренней резолюцией CONTROL-шагов.

`semantics` не владеет: выполнением модулей, персистенцией, транспортом, retry, планировщиком, диспетчеризацией внешних эффектов, генерацией `requestId`.

---

## 2. Архитектура

```
Flow3-артефакт
     │
     ▼
 semantics          (эта библиотека)
     │
     ▼
 orchestrator       запускает модули, сохраняет state, диспетчеризует эффекты
     │
     ▼
 runtime            инфраструктура: Kafka, HTTP, БД, таймеры
```

Оркестратор **не должен** интерпретировать семантику Flow3 (условия маршрутизации, граф шагов, резолюция путей). `semantics` **не должна** выполнять инфраструктурные обязанности. Это нормативная граница.

---

## 3. DSL Flow3

### 3.1. Таксономия шагов

Поле `steps` в Flow3-артефакте должен быть непустым объектом-маппингом (`Record<StepId, StepDefinition>`).

| `type`     | `subtype`                    | Кто исполняет           |
|------------|------------------------------|-------------------------|
| `PROCESS`  | `RULES` `MAPPINGS` `DECISIONS` | оркестратор через `executeStep` |
| `CONTROL`  | `ROUTE` `SWITCH`             | semantics внутренне — до `executeStep` не доходят |
| `EFFECT`   | `COMMAND` `CALL` `SUBFLOW`   | оркестратор             |
| `WAIT`     | `MESSAGE` (`WAIT/MESSAGE`)   | оркестратор             |
| `TERMINAL` | `COMPLETE` `FAIL`            | semantics               |

### 3.2. Executable PROCESS — привязка через `contract`

Executable `PROCESS`-шаги (RULES, MAPPINGS, DECISIONS) используют `contract.input.ref` и `contract.output.ref`:

```json
{
  "type": "PROCESS",
  "subtype": "RULES",
  "artefactId": "rules.validate",
  "contract": {
    "input":  { "ref": "$.context.input" },
    "output": { "ref": "$.context.checks.validation" }
  },
  "nextStepId": "next"
}
```

`contract.input.ref` — резолвируется `plan(...)` в `step.input`.  
`contract.output.ref` — используется `reduce(...)` для записи вывода модуля в state.  
`inputRef` / `outputRef` **запрещены** на executable PROCESS шагах.

### 3.3. CONTROL-шаги

`CONTROL/ROUTE` читает `factRef` (скалярный путь) и выбирает ветку из `cases`.  
`CONTROL/SWITCH` читает `context.decisions[decisionSetId].outcome` и выбирает из `cases`.  
Оба должны иметь `defaultNextStepId`. Оба резолвируются полностью внутри `semantics`.

```json
{ "type": "CONTROL", "subtype": "ROUTE", "factRef": "$.context.facts.ok",
  "cases": { "true": "step_ok", "false": "step_fail" }, "defaultNextStepId": "step_fail" }
```

### 3.4. EFFECT-шаги

```json
{ "type": "EFFECT", "subtype": "COMMAND", "operationId": "abs.create",
  "inputRef": "$.context.facts.request", "nextStepId": "wait_abs", "onErrorStepId": "finish_fail" }
```

`inputRef` — каноническая привязка входа для `EFFECT`-шагов. `operationId` — ключ диспетчеризации для оркестратора.

Для `SUBFLOW` обязательны `flowId` и `flowVersion`:

```json
{ "type": "EFFECT", "subtype": "SUBFLOW", "operationId": "child.process",
  "flowId": "child.flow", "flowVersion": "2026-04-01",
  "inputRef": "$.context.facts.input", "nextStepId": "wait_child" }
```

### 3.5. WAIT-шаг

```json
{ "type": "WAIT", "subtype": "MESSAGE", "sourceStepId": "send_command",
  "nextStepId": "next", "onErrorStepId": "finish_fail", "onTimeoutStepId": "finish_timeout" }
```

`plan(...)` материализует `operationId` (из исходного EFFECT-шага) и `requestId` (из `context.effects`) в нормализованный WAIT-шаг.

### 3.6. Пространства имён контекста

| Зона                | Записывает              |
|--------------------|-------------------------|
| `context.input`    | `createProcessState`    |
| `context.checks`   | executable PROCESS      |
| `context.facts`    | executable PROCESS      |
| `context.decisions`| DECISIONS-шаги          |
| `context.effects`  | `apply(...)` / `resume(...)` |
| `context.steps`    | трейс (при `traceMode !== 'off'`) |

---

## 4. Публичный API

```
validateFlow(flow, options?)  -> ValidationResult
prepareFlow(flow, options?)   -> PreparedFlow

createProcessState(params)                         -> ProcessState
plan(preparedFlow, state)                          -> NormalizedStep
reduce(step, state, output)                        -> ProcessState
apply(preparedFlow, state, stepId, effectResult)   -> ProcessState
resume(preparedFlow, state, stepId, waitResult)    -> ProcessState
```

### 4.1. `validateFlow(flow, options?)`

Возвращает `{ isValid: boolean; errors: ValidationIssue[]; warnings: ValidationIssue[] }`.  
Не должна бросать исключение для обычных DSL-проблем.

### 4.2. `prepareFlow(flow, options?)`

Возвращает иммутабельный `PreparedFlow`. Бросает `XCompileError`, если артефакт невалиден.

### 4.3. `createProcessState(params)`

```
createProcessState({ flow: PreparedFlow, processId: string, input?, meta?, trace? }) -> ProcessState
```

Создаёт канонический начальный `ProcessState`. Привязывает state к `preparedFlow.id` и `preparedFlow.version`. Устанавливает `currentStepId` в `preparedFlow.entryStepId`. Устанавливает `status: 'ACTIVE'`. Единственный канонический способ создать валидный начальный state.

### 4.4. `plan(preparedFlow, state)`

Детерминированно материализует текущий нормализованный шаг из `preparedFlow` и `state`, не мутируя state. Выполняет три операции:
1. **Нормализация** — transport-safe пакет шага
2. **Резолюция привязок** — разрешает `contract.input.ref` для PROCESS; `inputRef` для EFFECT; материализует `requestId` и `operationId` для WAIT
3. **Control-резолюция** — для CONTROL-шагов вычисляет условие ветвления и несёт `selectedNextStepId` в результате

### 4.5. `reduce(step, state, output)`

Фиксирует переход состояния. Применяется к шагам `PROCESS` и `CONTROL`:
- `PROCESS`: записывает `output` в `contract.output.ref`; переходит к `nextStepId`
- `CONTROL`: фиксирует `selectedNextStepId`; `output` должен быть `null`

### 4.6. `apply(preparedFlow, state, stepId, effectResult)`

Регистрирует диспетчеризацию EFFECT-шага. Переводит процесс в `WAITING`. Устанавливает `context.effects[stepId].requestId`.

Форма `effectResult`: `{ requestId: string; result: unknown; error: unknown; errorCode: string | null }`.

### 4.7. `resume(preparedFlow, state, stepId, waitResult)`

Доставляет внешний результат в WAIT-шаг. Переводит процесс из `WAITING` обратно в `ACTIVE` (или в ветку ошибки/таймаута).

Форма `waitResult`: `{ requestId: string; result: unknown; error: unknown; errorCode: string | null }`.

---

## 5. Нормализованный шаг

`plan(...)` возвращает `NormalizedStep` — transport-safe самодостаточный пакет. Оркестратор читает только поля нормализованного шага; он не должен инспектировать `PreparedFlow` или `ProcessState` напрямую.

| `step.type` | Ключевые поля |
|------------|---------------|
| `PROCESS`  | `artefactId`, `subtype`, `input` |
| `CONTROL`  | `subtype`, `selectedNextStepId` |
| `EFFECT`   | `operationId`, `subtype`, `input` |
| `WAIT`     | `sourceStepId`, `operationId`, `requestId` |
| `TERMINAL` | `subtype`, `result` |

---

## 6. ProcessState

```ts
{
  id: string;          // flow id
  version: string;     // версия flow (привязана при createProcessState)
  processId: string;
  status: 'ACTIVE' | 'WAITING' | 'COMPLETE' | 'FAIL';
  traceMode: 'off' | 'basic' | 'verbose';
  currentStepId: string;
  currentStepType: string;
  currentStepSubtype: string;
  context: ProcessContext;
  history: ProcessHistoryEntry[];
  result: TerminalResult | null;
  meta: JsonObject;
}
```

`ProcessState` — это plain JSON-safe объект. Персистенцией и транспортом владеет оркестратор.

---

## 7. Ошибки

Два семейства ошибок:

**`XCompileError`** — бросается `prepareFlow(...)` при структурно невалидном Flow3-артефакте. Имеет `code` (`FLOW_*`), `message`, опциональный `details`.

**`XRuntimeError`** — бросается `plan(...)`, `reduce(...)`, `apply(...)`, `resume(...)` при нарушении runtime-контракта. Имеет `code` (`FLOW_*`), `message`, опциональный `details`.

Все `code` — стабильные идентификаторы (например `FLOW_STEP_MISMATCH`, `FLOW_PATH_NOT_RESOLVED`, `FLOW_REDUCE_INVALID_TYPE`). Оркестратор может использовать `code` для машиночитаемой обработки ошибок.

---

## 8. Инварианты

- `plan(...)` детерминирован: одинаковые `preparedFlow` + `state` всегда возвращают один и тот же `NormalizedStep`
- `plan(...)` никогда не мутирует state
- Все публичные runtime-контракты transport-safe (JSON-safe)
- `ProcessState.version` должна совпадать с `PreparedFlow.version` — проверяется при каждом вызове `plan(...)`
- Оркестратор не должен вызывать `reduce(...)` для шагов `EFFECT`, `WAIT`, `TERMINAL`
- Оркестратор не должен конструировать `ProcessState` вручную — только через `createProcessState(...)`
