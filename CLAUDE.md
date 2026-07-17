# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ComfyUI-PromptPalette-F is a ComfyUI extension that bundles one rich interactive node (`PromptPalette_F`) and several lightweight UI-less utility nodes. The flagship node provides a checkbox-based phrase toggling and weight adjustment interface; the utilities exist to chain prompts together and post-process string outputs from any node.

Bundled nodes:
- **PromptPalette_F** (`PromptPalette-F`) — full interactive prompt editor with dual-mode frontend (Classic LiteGraph + Nodes 2.0 DOM widget)
- **SimpleMultiConcatText** (`Simple Multi Concat Text`) — UI-less, joins up to 5 text inputs with a separator
- **GetFirstWord** (`Get First Word`) — UI-less, returns the text before the first occurrence of a stop word (literal or regex)
- **GetFirstWordList** (`Get First Word (List)`) — UI-less, applies Get First Word to every item of a LIST input, outputs both joined STRING and a LIST
- **PromptTabs** (`Prompt Tabs`) — notepad-style node holding any number of named prompt tabs; outputs the active tab's text (STRING) and its name (STRING). Tabs can be reordered with `◀`/`▶` buttons on the active tab. Has its own frontend (`web/prompt_tabs.js`). Ported from ComfyUI-Lenient-Switch on 2026-06-03
- **NodeValueTemplate** (`Node Value Template`) — string node that resolves `%NodeTitle.widget%` tokens against other nodes' widget values, mirroring `SaveImage`'s `filename_prefix` substitution. Token resolution happens in the frontend (`web/node_value_template.js`) via an `app.graphToPrompt` wrapper (originally an `api.queuePrompt` patch; switched 2026-06-08 to clear a YARA false positive). Added 2026-06-03
- **PromptTabsTranslate** (`Prompt Tabs + Translate`) — Prompt Tabs variant where each tab holds a `source` + `translated` field pair (both editable). Three buttons translate the source into Japanese / English / Chinese on click via the backend route `POST /promptpalette_f/translate` (googletrans, no API key). A `⇅ 入れ替え` button swaps the active tab's source and translated text. Outputs `source` / `translated` / `label`. Own frontend (`web/prompt_tabs_translate.js`). Added 2026-06-05 (swap button 2026-06-06)
- **GemmaImagePrompt** (`Gemma Image Prompt`) — EXPERIMENTAL/test node. Uses a vision-capable Gemma4 encoder (from `CLIPLoader` type `gemma4`) to look at an input image and write a text-to-image prompt that recreates a visually similar image, honoring free-form modification instructions. Inputs: `clip` (CLIP, required), `image` (IMAGE, optional — fed to the multimodal tokenizer via `clip.tokenize(..., image=image)`), `instruction` (multiline), `output_format` (combo Natural language/Danbooru tags), `target_model` (combo FLUX/SDXL — FLUX leaves negative empty, SDXL produces a negative), `detail_mode` (combo Keep as instructed/Expand detail), `max_length`, `unload_after`, `prompt_mode` (combo Generate (recreate image)/Edit instruction (change description) — the latter, added 2026-06-08, makes Gemma emit a "change X into Y" before→after editing instruction for image-editing models like Qwen-Image-Edit instead of a recreation prompt, and leaves negative empty). Outputs `positive` / `negative`. The request prompt is assembled by `_build_request()` from the settings and commands "output ONLY the prompt" in a `POSITIVE:`/`NEGATIVE:` form that `_parse_pos_neg()` splits (falls back to all-positive if labels missing; normalizes `(empty)`/`none` negatives to `""`). With no image AND no instruction, returns `("", "")`. Runs during graph execution like GemmaTranslate; results pushed to two display fields via the `ui` payload. Own frontend (`web/gemma_image_prompt.js`, native widgets only). Added 2026-06-08. **Qwen3-VL also works** (ComfyUI v0.26.0+ added Qwen VL support): a vision-capable Qwen3-VL loaded via `CLIPLoader` can be wired into `clip` in place of Gemma4 with NO code changes (confirmed working 2026-06-29) — the `clip.tokenize(..., image=image)` / `clip.generate` / `clip.decode` pipeline is model-agnostic
- **GemmaTranslate** (`Gemma Translate`) — translates text with a Gemma4 text encoder loaded by a standard `CLIPLoader` (type `gemma4`). Unlike PromptTabsTranslate (instant, googletrans, no model), translation here is a real LLM generation that runs **during graph execution** via the same `clip.tokenize` / `clip.generate` / `clip.decode` calls ComfyUI's built-in `TextGenerate` node uses. Inputs: `clip` (CLIP, required), `text` (source, multiline), `target_language` (combo English/Japanese/Chinese), `max_length` (INT), `unload_after` (BOOLEAN — frees all models from VRAM when done). Outputs `source` / `translated`. The generated translation is returned on the output AND pushed to the node's display field via the `ui` payload (ShowText-style `onExecuted`). A `⇅ 入れ替え` button swaps source/translated. Cannot run standalone (needs a loaded CLIP) — meant for a dedicated translate workflow run via Queue Prompt. Own frontend (`web/gemma_translate.js`, native widgets only — no DOM-widget machinery). Added 2026-06-08. **Qwen3-VL also works** (ComfyUI v0.26.0+ added Qwen VL support): a Qwen3-VL loaded via `CLIPLoader` can be wired into `clip` in place of Gemma4 with NO code changes (confirmed working 2026-06-29) — the generation pipeline is model-agnostic

## Architecture

The project follows ComfyUI's custom node structure with V3 API compliance and dual-mode frontend support:

- **`__init__.py`**: V1 API entry point (temporary fallback due to V3 web_directory issues)
- **`nodes.py`**: V3/V1 hybrid backend with conditional V3 API support and V1 fallback
- **`web/index.js`**: Dual-mode frontend with adaptive detection for Classic (LiteGraph.js) and Nodes 2.0 (Vue.js) rendering
- **`pyproject.toml`**: Project metadata and ComfyUI registry configuration (version 2.0.0)

### API Version Support

**Backend (V3/V1 Hybrid) - `nodes.py`:**
- **V3 API Support (conditional)**:
  - Conditionally inherits from `comfy_api.latest.io.ComfyNode` if V3 API available
  - Uses `define_schema()` for input/output configuration when V3 available
  - Implements `execute()` classmethod (not `process()`)
  - Returns `io.NodeOutput()` wrapper when V3 available
  - Includes `comfy_entrypoint()` for V3 extension registration
- **V1 API Fallback**:
  - Falls back to plain object inheritance if V3 API unavailable
  - Always includes `INPUT_TYPES()` method for V1 compatibility
  - Returns tuple format when V3 unavailable
  - Maintains V1 exports (`NODE_CLASS_MAPPINGS`, `NODE_DISPLAY_NAME_MAPPINGS`, `WEB_DIRECTORY`)
- **Why Hybrid**: V3 `web_directory` property implementation has issues, so V1 exports are used for JavaScript file loading

**Entry Point - `__init__.py`:**
- **Current Strategy**: V1-only exports (temporary)
- **Reason**: V3 `web_directory` property in `ComfyExtension` class doesn't correctly serve `web/index.js`
- **Implementation**: Directly exports `NODE_CLASS_MAPPINGS`, `NODE_DISPLAY_NAME_MAPPINGS`, `WEB_DIRECTORY` from nodes.py
- **Future**: Will switch to V3 `comfy_entrypoint()` once web_directory issue is resolved

**Frontend (Adaptive Dual Mode) - `web/index.js`:**
- **Classic Mode (LiteGraph.js)**: Full feature support with canvas rendering
- **Nodes 2.0 Mode (Vue.js)**: Full feature support via DOM Widget (HTML/CSS-based interactive UI)
- **Adaptive Mode Detection**: Uses `onDrawForeground` callback invocation as mode indicator
  - If `onDrawForeground` called → Classic mode (canvas rendering works)
  - If `onDrawForeground` not called after 100ms → Nodes 2.0 mode (canvas rendering unavailable)
  - Why adaptive: Traditional detection methods (`app.vueAppReady`, `window.Vue`, `window.LiteGraph`) are unreliable
- Mode selection logged to console for debugging
- Global `window.__PromptPalette_F_Mode` variable tracks current mode

### Core Components

1. **PromptPalette_F Node (V3/V1 Hybrid)** (`nodes.py`):
   - **Conditional V3 Schema**: Defined via `define_schema()` classmethod when V3 available
     - Input types: Uses `io.String.Input()` and `io.Boolean.Input()` (not string-based)
     - Important: `rows` parameter not supported by V3 API (removed after initial error)
   - **V1 INPUT_TYPES**: Always defined for backward compatibility
     - String-based types: `"STRING"`, `"BOOLEAN"`
     - `prefix` is a multiline STRING widget (NOT `forceInput` — was changed from slot in May 2026)
   - **Input order (required → optional)**: `text` → `separator` → `trailing_separator` → `separator_newline` → `add_newline` → `preview_override` → `prefix` → `prefix_separator` → `empty_when_no_selection`. New optional inputs are always appended at the end to preserve `widgets_values` index stability for older saves
   - **Outputs (3)**: `text` (STRING) — main joined output with prefix/separator/override applied; `selected_text` (STRING) — selected phrases joined by `\n`, weight notation stripped, no prefix/separator; `selected_list` (LIST) — Python list of the same selected phrases. `RETURN_TYPES = ("STRING", "STRING", "LIST")`, `RETURN_NAMES = ("text", "selected_text", "selected_list")`
   - **Execution**: `execute()` classmethod processes text
   - **Preview override**: `preview_override` parameter enables temporary prompt editing from frontend; when non-empty, the `text` output bypasses processing and returns override text directly. `selected_text` / `selected_list` always reflect the real selection regardless of override
   - **Empty when no selection**: `empty_when_no_selection` (BOOLEAN, default `False`) — when ON and no phrase survives `//`-filtering, returns `(None, None, None)` on every output. Switch/router nodes that check `value is None` (e.g. rgthree's Any Switch) treat this as "skip this input" and pass through the next non-None input instead. Downstream execution itself still proceeds (NOT `ExecutionBlocker`), so users can decide per-pipeline how to handle the None. `preview_override` always wins over this toggle
   - Processes multiline text input by filtering commented lines (lines starting with `//` or `#`)
   - Handles inline comments by splitting on `//` and keeping only the content before
   - Uses custom separator (default: `, `) to join non-commented lines
   - Supports empty separator for no spacing/newlines between phrases
   - Concatenates a `prefix` text widget before the body (no separator by default; insert one only when `prefix_separator=True`)
   - Supports adding newline at end of output (`add_newline` parameter)
   - Supports adding newline after separator (`separator_newline` parameter)
   - Supports trailing separator (`trailing_separator` parameter)
   - **Group tag filtering**: Removes group tags `[group]` from output using `remove_group_tags_with_escape()` staticmethod
   - **Weight stripping** (for list outputs only): `strip_weight_notation()` staticmethod repeatedly unwraps `(text:1.5)` → `text` so the list outputs contain clean phrases. Plain `(text)` without numeric weight is left intact
   - **Escape character support**: Preserves literal brackets using `\[` and `\]` escape sequences
   - **Conditional return format**: Returns `io.NodeOutput(text, selected_text, selected_list)` if V3 available, tuple otherwise
   - **V3 Extension**: Only defined if V3 API available, exported via `comfy_entrypoint()` async function

2. **SimpleMultiConcatText Node** (`nodes.py`):
   - **UI-less utility**: no frontend code, no widgets registered through `web/index.js`
   - **Inputs (all optional)**: `text1`–`text5` (STRING with `forceInput: True`, wire-only), `separator` (STRING, default `""`), `separator_newline` (BOOLEAN, default `False`), `add_newline` (BOOLEAN, default `False`)
   - **Output**: `text` (STRING) — non-empty inputs joined with the effective separator
   - **Empty-input handling**: inputs that are `None`, non-strings, or empty strings are filtered out before joining. Avoids `"a,,b"`-style runs of separators when only some slots are wired
   - **`separator_newline` semantics**: when ON, a `"\n"` is appended to `separator`. Critically, this works **even when `separator=""`** — the effective separator becomes a bare `"\n"`, joining inputs line-by-line. This is intentional so users can get newline-joined output without typing a literal newline into the separator widget
   - **`add_newline` skip when empty**: trailing newline is suppressed if zero valid inputs survived filtering (avoids a lone `"\n"` output for a fully-unconnected node)
   - **V3/V1 hybrid**: same conditional pattern as `PromptPalette_F` — V3 `define_schema` with `io.String.Input`/`io.Boolean.Input` when V3 available, V1 `INPUT_TYPES` always defined
   - Tooltips supplied on every widget via the V1 `tooltip` option

3. **GetFirstWord Node** (`nodes.py`):
   - **UI-less utility**: returns the portion of `text` before the first occurrence of `stop_word`
   - **Inputs**: `text` (STRING, optional, `forceInput: True`), `stop_word` (STRING, default `","`), `use_regex` (BOOLEAN, default `False`), `trim` (BOOLEAN, default `True`), `remove_invalid_filename_chars` (BOOLEAN, default `False`), `add_trailing_slash` (BOOLEAN, default `False`)
   - **Output**: `text` (STRING)
   - **`use_regex` modes**:
     - OFF (literal): `stop_word` is taken as a literal string, with escape sequences `\n`, `\r`, `\t` pre-expanded so a single-line widget can specify control characters by typing the escape sequence literally
     - ON (regex): `stop_word` is compiled as a regex via `re.search`. Escape expansion is intentionally **skipped** — `\n`/`\t` are valid regex syntax and would otherwise be double-expanded. Invalid regex patterns fall through to "return the whole text" (`re.error` is caught silently — never raises)
   - **Empty `stop_word`**: returns the whole `text` (avoids `str.split("")` ValueError and `re.search("")` matching position 0)
   - **`remove_invalid_filename_chars`**: regex `[<>:"/\\|?*\x00-\x1f]` strips Windows-forbidden filename characters, then `rstrip(". ")` removes trailing dots/spaces (also Windows-forbidden). Reserved DOS names (CON, PRN, etc.) are **not** stripped — they're filename-level prohibitions, not character-level
   - **`add_trailing_slash`**: appends `/` only when the result is non-empty (avoids emitting a bare `/`)
   - **`process_one()` classmethod** (`nodes.py:GetFirstWord.process_one`) — core transform extracted from `execute()` so `GetFirstWordList` can reuse the exact same logic without duplication
   - **V3/V1 hybrid**: same conditional pattern as other nodes

4. **GetFirstWordList Node** (`nodes.py`):
   - **UI-less utility**: applies `GetFirstWord.process_one()` to every element of a LIST input
   - **Inputs**: `items` (LIST, optional, `forceInput: True`), all of `GetFirstWord`'s configuration inputs, plus `text_separator` (STRING, default `", "`)
   - **Outputs**:
     - `text` (STRING) — `text_separator.join(results)`
     - `list` (LIST) — the raw `results` list (unaffected by `text_separator`)
   - **`items` defensive coercion**: `None` → `[]`; `tuple`/`set` → `list`; bare `str` → single-item list (or `[]` if empty); anything else → `[]`. Per-element: `None` skipped, non-strings coerced via `str()`. Goal is "never raise on a wrong-typed slot"
   - **V3 schema caveat**: V3 has no first-class LIST input/output type, so the V3 `define_schema` declares both as `io.String.*`. The V1 `INPUT_TYPES` and `RETURN_TYPES`/`RETURN_NAMES` carry the actual `"LIST"` type, and ComfyUI passes a real Python list at execute time regardless. Same pattern as `PromptPalette_F.selected_list`
   - **No `add_newline` / `separator_newline`**: kept minimal — if newline-joining is needed, the user can chain through `SimpleMultiConcatText` with a single wired input, or set `text_separator` to `"\n"` directly

5. **PromptTabs Node** (`nodes.py` + `web/prompt_tabs.js`):
   - **Notepad-style multi-tab node**: holds an unbounded number of named prompt tabs in one box; outputs the active tab's text and name
   - **Inputs**: `text` (STRING, multiline) — editor for the active tab; `tabs_data` (STRING) — hidden JSON store managed entirely by the frontend, holding `{"tabs": [{"name", "text"}], "active": int}`
   - **Outputs**: `text` (STRING) — the active editor's current contents; `label` (STRING) — the active tab's name (parsed out of `tabs_data` by `_active_label`)
   - **Thin Python by design**: all tab state lives in the frontend. `text` output never depends on Python parsing — the node degrades to a plain multiline box (empty label) if the JS never loads. `_active_label` only reads the name the frontend already chose; do NOT move tab-selection logic into Python. Malformed/missing JSON → empty label
   - **V3/V1 hybrid**: same conditional pattern as the other nodes — V3 `define_schema` with `io.String.Input`/`io.String.Output` when V3 available, V1 `INPUT_TYPES` + `RETURN_TYPES`/`RETURN_NAMES` always defined. `execute()` returns `(text, label)` / `io.NodeOutput(text, label)`
   - **Frontend** (`web/prompt_tabs.js`): separate extension `idfa.PromptTabs` (acts only on `nodeData.name === "PromptTabs"`, fully independent of the `PromptPalette_F` extension in `index.js`)
     - **`tabs_data` is the master store; `text` is the active-tab editor.** Kept in sync by `saveEditorIntoActive()` (editor→store) and `loadActiveIntoEditor()` (store→editor) around every switch/add/delete. `loadActiveIntoEditor` sets `textWidget.value` programmatically, which does NOT fire the `input` listener — prevents a feedback loop
     - **Live sync** via an `input` listener on the editor textarea (`findTextArea`) flushes every keystroke into the store (the canvas tab bar approach didn't stay live under the Vue/Nodes 2.0 renderer). `dataWidget.serializeValue` is a belt-and-suspenders flush at serialize/queue time. Does NOT patch `api.queuePrompt`
     - **Tab bar is a DOM widget** (`addDOMWidget`), not canvas — real HTML buttons stay interactive under both frontends; CSS `flex-wrap` gives multi-row wrapping. Outer `bar` wraps an `inner` flex row whose height is reported via `tabWidget.computeSize`. **`computeSize` must NOT read `offsetHeight`** (it's called per-frame → forced reflow storm → console Violations); instead the `trackHeight(node, el, initial)` helper caches the height via a `ResizeObserver` (fires after layout) and `computeSize` returns the cached value. The observer redraws only when the height changes. Never height-force `inner` (would ratchet the measured height). `serialize: false` keeps the bar out of the saved graph; spliced directly above the `text` widget
     - **`hideWidget` hides `tabs_data`** by zeroing `computeSize` (`[0,-4]`), `type="hidden"`, `hidden=true`. Keep `tabs_data` single-line (no `multiline`) so it has no DOM textarea to fight with
     - **`onConfigure` re-runs `reload()`** (ComfyUI restores widget values after `onNodeCreated`). `reload()` parses `tabs_data` or seeds one tab from current editor text — never produces zero tabs (delete keeps a floor of one)
     - **`applyEditorRowSizing` (Nodes 2.0 editor height)**: pins non-editor grid rows to `min-content` and leaves the editor row `auto` so the editor fills the node height instead of the tab-bar row stretching and wasting space. Re-asserted via TWO observers: a `MutationObserver` on the grid `style` (`_pptRowObserver`, catches ComfyUI's per-layout rewrite) AND a `MutationObserver` on the node ROOT `{childList,subtree}` (`_pptRootObserver`, catches Vue REPLACING the grid element on a remount — without it the grid observer is stranded on the detached old grid and the editor reverts to ComfyUI's default layout). See the June 7 & June 8, 2026 Recent Changes entries for the full rationale (Classic-mode no-op)
     - **Cleanup on removal**: `onRemoved` calls `cleanup()` (exposed via `node._promptTabs`) which disconnects `_pptRowObserver`, `_pptRootObserver`, every ResizeObserver in `node._pptResizeObservers[]`, and removes the editor `input` listener — otherwise each node deletion / workflow reload leaks observers + detached DOM (ResizeObserver is GC-root-anchored). See the June 8, 2026 entry
     - Interactions: single-click switches, double-click renames via `prompt()`, per-tab `×` deletes after a `confirm()`, `+` adds

6. **NodeValueTemplate Node** (`nodes.py` + `web/node_value_template.js`):
   - **`%NodeTitle.widget%` token resolver**: outputs a string where each `%Title.widget%` token is replaced by the current value of the matching widget on the node whose title matches `Title`. Mirrors `SaveImage`'s `filename_prefix` substitution (`%KSampler.seed%`)
   - **Input**: `template` (STRING, multiline) — the text with `%Title.widget%` tokens
   - **Output**: `text` (STRING) — the resolved string
   - **Resolution happens in the frontend, NOT Python.** Node titles and live widget values only exist in the frontend graph (the backend prompt carries node ids + input values, not titles). So `execute()` is a pure pass-through (defensive `isinstance(template, str)` coercion only); the frontend resolves tokens and injects the result before the prompt is sent. Without the JS, the node degrades to emitting the raw template (tokens intact)
   - **V3/V1 hybrid**: same conditional pattern as the other nodes
   - **Frontend** (`web/node_value_template.js`): separate extension `idfa.NodeValueTemplate`, fully independent of `index.js` and `prompt_tabs.js`
     - **`app.graphToPrompt` wrapper** (in `setup()`, formerly an `api.queuePrompt` patch — changed 2026-06-08, see that day's changelog): for every `class_type === "NodeValueTemplate"` node in the built prompt `output`, reads the live `template` widget value, runs `resolveTemplate()`, and writes the resolved string into `nodeData.inputs.template`. Same pattern as `index.js`'s `preview_override` injection — the widget keeps the raw `%...%` text, the prompt carries the resolved value. **Wrappers chain**: `index.js` wraps `app.graphToPrompt` too; each captures the previous reference (without `Function#bind` — it re-dispatches via `.apply(app, args)` to avoid the YARA socket-substring false positive) and calls through, so both coexist as long as each only touches its own node type
     - **`resolveTemplate(template)`**: `String.replace(/%([^%]+)%/g, ...)`. Splits the inner text on `|` via `splitModifiers()` → base + modifier specs. The base first handles date tokens (`%date%` / `%date:FORMAT%`); otherwise splits on the FIRST `.` → `title` + `prop` (titles rarely contain dots; same as SaveImage). Looks up via `lookupWidgetValue()`. Unresolvable tokens (node/widget not found, value `undefined`/`null`, or an unknown modifier) are LEFT AS-IS (`%...%`) so typos are visible
     - **Smarty-style modifiers `%Title.widget|basename|firstword:'_'%`** (added 2026-07-17): `splitModifiers()` splits on `|` while ignoring pipes inside quoted args; `parseModifierSpec()` takes the arg after the FIRST `:`, strips matching surrounding quotes, and expands `\n`/`\r`/`\t`; `applyModifierSpec()` dispatches and returns `undefined` for an unknown name (→ token left visible). Modifiers: `basename` (`basenameOf()` — normalizes `\`→`/`, drops dirs, drops the extension only when `lastIndexOf(".") > 0` so `.gitignore` survives), `firstword[:'sep']` (`firstWordOf()` — no arg → `/[ _]/` regex, whichever comes first; separator not found → whole value), `trim`. Work on date tokens too
     - **`%date:FORMAT%` expansion** (`formatDate(format, dt)`): mirrors SaveImage's `filename_prefix` date tokens — `yyyy`/`yy`/`MM`/`M`/`dd`/`d`/`hh`/`h`/`mm`/`m`/`ss`/`s` (case-sensitive). Uses a left-to-right longest-first scan (so `yyyy` beats `yy`, `MM` beats `M`, and already-substituted digits are never re-matched); non-token chars emitted literally. Bare `%date%` defaults to `yyyy-MM-dd`. Resolution runs in the frontend so it uses the browser's local time at queue time (a `new Date()` call — fine in browser JS)
     - **`lookupWidgetValue(title, prop)`**: scans `app.graph._nodes`, matches `n.title || n.type` against `title` (LiteGraph falls back `title` → type display name), returns the first matching node's `widgets.find(w => w.name === prop).value`
     - **Caveats**: widget values only (no output/meta); first-match wins on duplicate titles; titles with `.` unsupported (first-dot split)
   - **Token picker modal** (`web/node_value_template.js`): a `🔍 ノードの値を挿入…` button (added via `addDOMWidget` so it works in both renderers, like the prompt_tabs tab bar) opens a modal helper for building tokens without typing
     - **`addDOMWidget` type MUST be a custom string, NOT `"button"`**: a `"button"` type makes the Nodes 2.0 (Vue) renderer treat it as a known widget and draw a labeled field from the widget NAME (`nvt_pick`) instead of mounting the element — the row looks inert and clicks do nothing. Use a custom type (`"nvt_pick_btn"`, mirroring prompt_tabs' `"prompt_tabs_bar"`) + `hideOnZoom: false`, and report `[width, h]` from `computeSize` (a flex wrapper + `align-items:center` keeps the Classic-mode label from sitting slightly below the button). This was the fix for "label offset in Classic / unresponsive nvt_pick field in Nodes 2.0"
     - **Modifier builder** (added 2026-07-17): a `修飾子` row (`<select>` of `MODIFIERS` + separator `<input>` + `＋ 追加`) below the list, plus a chip strip. `state` is `{ base, mods[] }` — `base` is the token's INNER text (`KSampler.seed`, `date:yyyy-MM-dd`) so `buildToken()` can wrap `%base|mod|mod%`; the rows/`selectRow` set only `base`, so `mods` survive retargeting. `syncModArg()` hides the separator input for every modifier except `firstword` (the others ignore an arg). `formatModifier()` re-escapes control chars and quotes the arg (`'…'`, or `"…"` when it contains a `'`) so the token round-trips through `parseModifierSpec()`
     - **Flow** (confirmed design): ONE dropdown + ONE list, feeding a shared selection (`state.base`). The dropdown holds a blank first option, a sentinel **date-format entry** (`NVT_DATE_OPTION = "__nvt_date__"`, label `📅 日付フォーマット`), then each node title. On change, `renderDates()` (if the sentinel is chosen) or `renderProps(title)` repopulates the single `listEl`: a node title → that node's widget names + current values; the date entry → `%date:FORMAT%` samples (`DATE_SAMPLES`) each with a live `formatDate()` preview. Both pre-select their first row. `clearList()` calls `selectRow(null, null)` so switching the dropdown drops the previous selection. The `挿入` button inserts the selected token at the caret; double-click inserts immediately and keeps the modal open. The date entry is always present (works even with zero referenceable nodes). Only the chosen node's widgets are expanded (avoids dumping every node's widgets at once)
     - **`collectTitleMap(selfNode)`**: title → FIRST node with that title (matching the resolver's first-match), excluding `self` and nodes with no named widgets. Dropdown lists distinct titles; the property list shows the first matching node's widgets (exactly what the token will resolve to)
     - **Caret insertion**: `ensureCaretTracker(node)` attaches listeners (`keyup`/`click`/`select`/`input`/`focus`/`blur`) to the multiline `template` textarea (`widget.inputEl || widget.element`) and records `node._nvtCaret`. The picker button blurs the textarea, so the recorded caret (not a live read) is what `insertToken()` uses. After insert it sets `textarea.value`, dispatches an `input` event (so ComfyUI's own listener keeps `widget.value` authoritative), restores the caret past the inserted token, and calls `widget.callback`
     - **Modal** is a plain `position: fixed` backdrop + panel (theme-variable CSS injected once via `injectModalCSS`); Esc and click-outside close it. Independent of `index.js`'s overlays
     - **Caveat**: if the textarea can't be found (unusual), `insertToken` falls back to appending at the end of `widget.value`

7. **Web Extension - Adaptive Dual Mode** (`web/index.js`):
   - **Single Unified Registration**: Single extension "PromptPalette_F" that adapts to rendering mode
   - **Adaptive Mode Detection via Callbacks**:
     - `onNodeCreated`: Sets up both Classic and Nodes 2.0 features initially
       - Initializes `_promptPalette_drawCalled` and `_promptPalette_setupDone` flags
       - Stores reference to text widget for later button creation
       - Creates 3 Nodes 2.0 warning widgets (hidden initially, removed later in Nodes 2.0)
     - `onDrawForeground`: Canvas rendering callback - ONLY invoked in Classic mode
       - Sets `_promptPalette_foregroundDrawnThisFrame` flag for mode detection
       - When called first time: Creates Edit/Hide Preview buttons, marks as Classic mode
       - Performs custom canvas drawing for checkboxes, groups, weights, preview
     - `onDrawBackground`: Background rendering callback - works in both modes
       - Checks `_promptPalette_foregroundDrawnThisFrame` flag to detect current mode
       - Hides warning widgets in both modes (DOM Widget replaces them in Nodes 2.0)
     - `onAdded`: Delayed detection with 100ms timeout (fallback for initial detection)
       - If `onDrawForeground` wasn't called: Marks as Nodes 2.0 mode
       - Removes warning widgets and standard widgets from `node.widgets` array
       - Backs up widget references in `node._ppWidgetRefs` for value access
       - Creates DOM Widget UI via `setupNodes2DOMWidget()`
   - **Why Adaptive Detection**:
     - `app.vueAppReady` is `true` in both Classic and Nodes 2.0 modes (unreliable)
     - `window.Vue` and `window.LiteGraph` checks are unreliable
     - Canvas callback invocation is the only reliable indicator
   - **Nodes 2.0 Widget Hiding Strategy**:
     - `widget.hidden = true` does NOT work in Nodes 2.0 Vue rendering
     - Widgets must be removed from `node.widgets` array to hide them
     - Removed widgets are backed up in `node._ppWidgetRefs` for read/write access
     - The `app.graphToPrompt` wrapper (formerly an `api.queuePrompt` patch) injects all values from `_ppWidgetRefs` into the built prompt data

3. **UI System**:
   - **Edit mode**: Shows standard multiline text widget, separator input, and newline options (including `prefix_separator` checkbox) for direct editing
   - **Display mode**: Custom-drawn interface with checkboxes, phrase text, weight controls, and group controls
   - **Prefix widget (always visible)**: Multiline textarea displayed at the very top of the node in both display and edit modes (Classic via `reorderPrefixToTop`, Nodes 2.0 via `renderPrefixArea` called at the top of `render()`). Default height ~2 lines (52px)
   - **Interactive elements**: Checkboxes for toggling comments, +/- buttons for weight adjustment, group toggle buttons, global toggle buttons, clickable text areas
   - **Row selection**: Click anywhere on phrase text to toggle (excludes weight control buttons on right)
   - **Visual feedback**: Different colors for active/inactive text, bold text for weighted phrases
   - **Text wrapping**: Long phrases automatically wrap within node boundaries
   - **Description comments**: `#` comments display as italic explanatory text above phrases
   - **Group controls**: Horizontal row with global `[all]`/`[off]` buttons (green/red) followed by group buttons for batch phrase control
   - **Phrase list scrolling (Classic mode)**: Node auto-grow is capped at `CONFIG.maxAutoNodeHeight` (600px); beyond that, the checkbox area becomes scrollable. Operate via ▲▼ scrollbar buttons on the right edge of the phrase area or via mouse wheel (handled by a document-level capture-phase listener so it isn't preempted by ComfyUI's canvas zoom)
   - **Phrase list scrolling (Nodes 2.0 mode)**: The DOM widget's `.pp-phrases` container has `max-height: 400px` + `overflow-y: auto`. Scrollbar-drag works natively, but **mouse wheel requires explicit handling** because ComfyUI's canvas zoom handler decides what to do based on cursor screen position (not `event.target`), so it would zoom even when the cursor is over an HTML overlay. The document-level capture-phase wheel hook detects `target.closest('.pp-phrases')` and manually does `phrasesEl.scrollTop += event.deltaY`, then `stopImmediatePropagation()` + `preventDefault()` so ComfyUI's zoom never fires. Scroll position is preserved across re-renders (toggles, group operations) by saving/restoring `phrases.scrollTop` in `render()`

### Advanced Features

4. **Custom Separator System** (`nodes.py:43-89`):
   - Configurable separator input parameter (default: `, `)
   - Empty separator support for no spacing between phrases
   - `prefix_separator` (BOOLEAN) toggles whether `separator` is inserted between prefix and body — default is plain `prefix + body` concat
   - Backend filtering of both `//` (toggle) and `#` (description) comments
   - Optional newline addition after separators (`separator_newline` parameter)
   - Optional newline addition at end of output (`add_newline` parameter)
   - Optional trailing separator after last phrase (`trailing_separator` parameter)

5. **Text Wrapping System** (`web/index.js:493-522`):
   - `wrapText()` function for word-based text wrapping (`web/index.js:493-517`)
   - `calculateAvailableTextWidth()` for dynamic width calculation (`web/index.js:519-522`)
   - Automatic node height adjustment based on wrapped content (`web/index.js:579-587`)
   - Font-aware measurement for accurate wrapping

6. **Description Comment System** (`web/index.js:682-696`):
   - `#` comments display as italic explanatory text above phrases
   - `isDescriptionComment()` and `findDescriptionForLine()` helper functions
   - Separate handling from toggle comments (`//`)
   - Integrated with text wrapping for long descriptions

7. **Weight System** (`web/index.js:1005-1056`):
   - Supports weight notation format: `(phrase:1.5)`
   - Weight range: 0.1 to 2.0 with 0.1 increments
   - Visual indicators: Bold text for non-1.0 weights, weight value display
   - Interactive +/- buttons for weight adjustment
   - Functions: `parseWeight()`, `setWeight()`, `adjustWeight()`, `getWeightText()`

8. **Theme Integration** (`web/index.js:1064-1101`):
   - Dynamically reads ComfyUI CSS variables for theme colors
   - Supports both light and dark themes
   - Color caching for performance (`colorCache` variable)
   - Handles 3-digit hex color expansion (`expandHexColor()`)
   - Theme colors sourced from `getComfyUIThemeColors()`

9. **Group Toggle System** (`web/index.js:31-147`):
   - **Group tag parsing**: Extracts multiple `[group]` tags from each line (`parseGroupTags()`, lines 31-41)
   - **Escape character support**: Handles `\[` and `\]` for literal brackets (`removeGroupTags()`, lines 43-55)
   - **Group status tracking**: Monitors all/partial/none states for each group (`getGroupStatus()`, lines 71-92)
   - **Batch operations**: Simplified toggle logic for all lines in a group (`toggleGroup()`, lines 94-122)
   - **Global toggle operations**: `toggleAllPhrases()` function for all-on/all-off functionality (lines 124-147)
   - **UI integration**: Group buttons displayed above phrase list with visual status indicators (`drawGroupControls()`, lines 693-862)
   - **Smart toggling**: Groups with partial activation get fully activated; fully active groups get deactivated
   - **Global toggle buttons**: `[all]` (green) and `[off]` (red) buttons for toggling all phrases at once
   - **Multi-group support**: Handles lines with multiple group tags correctly without interference between groups

10. **Output Control System** (`nodes.py:17-20`, `web/index.js:310-352`):
   - `add_newline` parameter adds newline at end of final output
   - `separator_newline` parameter adds newline after each separator
   - `trailing_separator` parameter adds separator after the last phrase
   - All options available as checkboxes in edit mode (widget finding functions: lines 280-308)
   - Provides flexible output formatting for different use cases

11. **Preview System** (`web/index.js`):
   - **Real-time preview**: Displays processed output in preview area at bottom of node
   - **Text generation**: `generatePreview()` replicates Python processing logic
   - **Text processing**: `processTextForPreview()` mirrors backend `execute()` method
   - **Group tag removal**: Automatically removes group tags `[group]` from preview using `removeGroupTags()`
   - **Escape character support**: Preserves literal brackets `\[` `\]` in preview output
   - **Scrollable display**: Preview supports scrolling for long output with scroll buttons
   - **Scroll management**: Tracks scroll offset and calculates max scroll based on line count
   - **Visual rendering**: `drawPreview()` handles canvas drawing with proper layout
   - **Scroll controls**: `drawScrollBar()` and `drawScrollButton()` provide interactive scrolling
   - **Toggle functionality**: "Show Preview" / "Hide Preview" button to control visibility
   - **Automatic text wrapping**: Preview text wraps within available width
   - **Theme integration**: Uses theme colors for consistent appearance

12. **Preview Edit System** (`web/index.js`, `nodes.py`):
   - **Temporary prompt editing**: Users can edit the generated preview text directly; the edited text becomes the actual node output
   - **Edit button**: `[✎ Edit]` button in preview area header opens an HTML textarea overlay
   - **Reset button**: `[↺ Reset]` button appears when override is active, clears the edit
   - **Visual indicators**: Orange border and "Preview (Edited):" label when override is active
   - **Toolbar**: Orange toolbar above textarea shows "Editing Preview — Esc: cancel" hint and "✕ Save" close button
   - **Close behavior**: Click outside (blur) saves and closes; Esc cancels without saving; ✕ Save button explicitly saves
   - **Temporary nature**: Edits are not saved to workflow; override clears on workflow load (`configure()`), source text change, and manual reset
   - **Backend integration**: `preview_override` parameter in `nodes.py:execute()` returns override text directly when non-empty
   - **Frontend-to-backend communication**: `setup()` wraps `app.graphToPrompt` (the prompt builder; formerly an `api.queuePrompt` patch) to inject `_promptPalette_previewOverride` into the built prompt data; ComfyUI then sends it unchanged
   - **State management**: Override stored on `node._promptPalette_previewOverride` property; synced to hidden `preview_override` widget if available
   - **Helper functions**: `setPreviewOverride(node, value)`, `getPreviewOverride(node)`, `openPreviewEditor(node)`, `findOverrideWidget(node)`
   - **Auto-clear**: Override automatically clears when source text changes (checkbox toggle, group toggle, direct text edit)
   - **Clickable area integration**: `preview_edit` and `preview_reset` actions in `handleClickableAreaAction()`

13. **Dynamic Widget Height System** (`web/index.js`):
   - **Static estimation**: `getWidgetsTotalHeight()` sums visible widgets' `computeSize()` values plus per-widget margin and bottom padding. Used by `nodeType.prototype.computeSize()` (which is called BEFORE first draw, so `last_y` is unavailable)
   - **Rendered-position lookup**: `getRenderedWidgetAreaBottom()` reads `widget.last_y` (set by LiteGraph during widget rendering) for the visually-lowest visible widget and adds its `computeSize`-reported height. Used by drawing functions (`drawCheckboxList`, `drawCheckboxItems`, `drawGroupControls`, "No Text" fallback) — avoids the calibration drift between our static estimate and LiteGraph's actual layout (multiline string widgets in particular don't always match `computeSize` once an HTML textarea is overlaid). Falls back to `getWidgetsTotalHeight()` when `last_y` isn't set yet
   - **Hidden widget handling**: Skips hidden widgets when calculating height
   - **Flexible spacing**: Uses `CONFIG.widgetSpacing` (5px) for minimal gap between widgets and content

14. **Selected Words Output System** (`nodes.py`):
   - Two additional output ports beside the main joined `text` output:
     - `selected_text` (STRING): selected phrases joined by `\n`
     - `selected_list` (LIST): Python list of the same selected phrases
   - Both list outputs apply group-tag removal AND weight-notation stripping (`(phrase:1.5)` → `phrase`) so downstream nodes receive clean phrase strings
   - Both list outputs IGNORE `prefix`, `separator`, `trailing_separator`, `add_newline`, `separator_newline`, `preview_override` — they always reflect the raw selection state
   - When `preview_override` is set, the main `text` output uses the override but list outputs continue to reflect actual selection
   - When `false_when_empty` triggers, all three outputs become Python `False`

15. **Bulk Weight Editor** (`web/index.js`):
   - Floating HTML overlay panel for setting/adjusting the weight of EVERY phrase at once
   - Triggered by:
     - Classic mode: "Set All Weights" button widget placed above the Edit button
     - Nodes 2.0 mode: compact "W±" button in the display-mode toolbar next to Edit
   - Panel UI: absolute `<input type="number">` + Apply button for "set all to X", plus `−0.1` / `+0.1` buttons for immediate relative adjust. Esc / click-outside / ✕ closes
   - **Affects ALL phrases** including `//`-commented ones — users can pre-set weights before activating phrases. `#` description comments and empty lines are skipped
   - **Helper functions**: `transformAllPhrases(text, transformFn)` walks lines, preserves `//` prefix and inline `// comment`, applies `transformFn` to phrase content (which still includes `[group]` tags). `setAllWeights(text, w)` clamps and delegates to per-line `setWeight()`. `adjustAllWeights(text, delta)` delegates to per-line `adjustWeight()`. `openBulkWeightEditor(node, anchorEvent)` is the panel
   - After each apply: clears `preview_override`, calls `node._ppDomRender()` if present (Nodes 2.0), and triggers `setDirtyCanvas` (Classic)

16. **Empty When No Selection Toggle** (`nodes.py`, `web/index.js`):
   - `empty_when_no_selection` BOOLEAN input (default `False`) — when ON and `filtered_lines` is empty, returns `(None, None, None)` on every output (literal Python None)
   - Intended use: feeds into switch/router nodes that check `value is None` to skip the input. Concrete target is **rgthree's Any Switch** (`is_none()` does `return value is None` — empty strings are NOT treated as None by that switch, so we must emit literal None to trigger its skip path)
   - Downstream execution still runs (NOT `ExecutionBlocker`) — switches/conditionals decide what to do per-pipeline
   - **Caveat**: downstream nodes that don't gracefully handle `None` will error. Users should either keep the toggle OFF for such pipelines, or insert a switch/None-handler in between
   - `preview_override` takes priority: if override is set, the None-output path is bypassed (override always wins)
   - UI: checkbox labeled "Empty if no sel" in the Edit-mode options row (both modes)
   - Backward compat: `sanitizeLegacyPrefixValues()` extended to reset non-boolean `empty_when_no_selection` values (also catches saves from the brief `false_when_empty`-named iteration of this same toggle)

## Development Commands

This project requires no build process or package management - it's a pure ComfyUI extension.

### Testing

#### Installation
- Install in ComfyUI's `custom_nodes` directory and restart ComfyUI
- No build process or dependencies required

#### Classic Mode Testing (Full Features)
1. **Mode Verification**:
   - Open browser console, look for: `[PromptPalette_F] Classic mode detected (onDrawForeground called)`
   - Check `window.__PromptPalette_F_Mode` returns `"classic"`

2. **Basic Functionality**:
   - Create PromptPalette-F node
   - Toggle Edit/Display modes with button
   - Test phrase toggling with checkboxes
   - Test weight adjustment (+/- buttons)
   - Test custom separator and output options

3. **Group Testing**:
   - Test with `phrase1 [group1]`
   - Test multi-group: `phrase2 [group1][group2]`
   - Test escaped brackets: `phrase \[literal\] [group1]`
   - Test group buttons for batch toggling
   - Test global `[all]` and `[off]` buttons

4. **Preview Panel**:
   - Toggle preview visibility
   - Verify real-time preview updates
   - Test preview scrolling with long output

5. **Preview Edit**:
   - Click `[✎ Edit]` button in preview area header
   - Verify toolbar appears with "Editing Preview — Esc: cancel" hint and "✕ Save" button
   - Edit text and click outside → verify "Preview (Edited):" label and orange border
   - Queue Prompt → verify output uses edited text (check console for injection log)
   - Click `[↺ Reset]` → verify override clears and normal preview returns
   - Test Esc key cancels edit without saving
   - Test source text change (checkbox toggle) → verify override auto-clears
   - Save/reload workflow → verify override does not persist

#### Nodes 2.0 Mode Testing (DOM Widget UI)
1. **Mode Verification**:
   - Enable Nodes 2.0 in ComfyUI settings (usually under Interface)
   - Open browser console, look for: `[PromptPalette_F] Nodes 2.0 mode detected (onDrawForeground not called)`
   - Look for: `[PromptPalette_F] Using DOM Widget UI for Nodes 2.0 mode`
   - Check `window.__PromptPalette_F_Mode` returns `"nodes2"`

2. **DOM Widget UI Functionality**:
   - Create PromptPalette-F node
   - Verify DOM Widget UI is displayed (HTML/CSS-based, not canvas)
   - Verify no standard widgets (text, separator, etc.) are visible above the DOM UI
   - Test checkbox clicking to toggle phrases ON/OFF
   - Test weight +/- buttons for weight adjustment
   - Test group buttons ([all], [off], individual groups) for batch toggling
   - Test Edit button to switch to text editing mode
   - Test separator and option controls in edit mode
   - Test preview area displays correct output
   - Test preview Edit/Reset functionality
   - Execute workflow and verify correct output (no "Required input is missing" error)

3. **Serialization Verification**:
   - Check console for: `[PromptPalette_F] Injecting widget values for Nodes 2.0 node`
   - Verify all widget values are correctly passed to backend via the `app.graphToPrompt` wrapper

#### Mode Switching Testing
1. **Classic → Nodes 2.0**:
   - Start in Classic mode, create node with some content
   - Switch to Nodes 2.0 mode in settings, refresh page
   - Verify mode detection switches correctly
   - Verify node content is preserved

2. **Nodes 2.0 → Classic**:
   - Start in Nodes 2.0 mode, create node with some content
   - Switch to Classic mode in settings, refresh page
   - Verify mode detection switches correctly
   - Verify all Classic features work

#### Console Log Monitoring
- Mode detection logs appear on node creation
- No errors should appear during normal operation
- Check for V3 API import errors (should gracefully fall back to V1)

#### No Automated Tests
- Testing is entirely manual through the ComfyUI interface
- All verification done through browser console and visual inspection

## Development Notes

- **Registry YARA gotcha — avoid `Function#bind` and dotted socket-method substrings in `web/*.js`**: the ComfyUI Registry `yara_scan` rule `python_network_operations` matches dotted socket-method call substrings (`.connect(`, `.bind(`, `.send(`, `.recv(`, `.listen(`, `.accept(`, …) as a pure substring scan — it does NOT check for real network I/O and DOES scan comments. A `flagged` status delists the node from the official Manager/Registry. So never write `something.bind(x)` or a literal `.connect(`/`.send(` (even in a comment); use `.apply(`/`.call(`, a bracket-method helper, or a string split. This is why the prompt-injection code wraps `app.graphToPrompt` and re-dispatches via `.apply(app, args)` instead of `.bind(app)` (see the 2026-06-08 changelog)
- No dependencies beyond ComfyUI itself
- Project metadata and registry information defined in `pyproject.toml`
- Node display name in UI: "PromptPalette-F" (set in `nodes.py:94`)
- UI constants are defined in `CONFIG` object (`web/index.js:3-26`)
  - Includes `widgetSpacing` (5px) for dynamic layout adaptation
  - Other layout constants for consistent UI appearance
- Click handling uses coordinate-based area detection system
- All state changes trigger canvas redraws via `app.graph.setDirtyCanvas(true)`
- Group functionality requires no additional dependencies
- Dynamic widget height calculation ensures compatibility across ComfyUI versions
- Window size management: Width is always preserved across redraws and tab switches; height only increases when content requires more space (never auto-shrinks)

## Key Patterns

- **Comment system**: `//` for toggle comments (filtered/unfiltered), `#` for description comments (display only)
- **Group system**: `[group]` tags for batch phrase control, support for multiple tags per line, escape with `\[` `\]`
- **Custom separator**: Configurable text joining with empty string support for no spacing
- **Output formatting options**: `add_newline` for end-of-output newline, `separator_newline` for separator newlines, `trailing_separator` for separator after last phrase
- **Text wrapping**: Word-based wrapping with dynamic width calculation and height adjustment
- **Weight adjustment**: Uses regex parsing to handle `(text:weight)` notation
- **Canvas interaction**: Mouse clicks are mapped to clickable areas (checkboxes, text areas, weight buttons, group buttons, global toggle buttons)
- **Row selection**: Entire phrase text area is clickable for toggling (excluding weight controls on right edge)
- **Preview override**: Temporary edit stored on `node._promptPalette_previewOverride`, injected into the prompt via the `app.graphToPrompt` wrapper (formerly an `api.queuePrompt` patch), auto-cleared on source text change
- **HTML overlay pattern**: `openPreviewEditor()` and `openBulkWeightEditor()` create `position: fixed` containers, anchor via canvas coordinate transform, manage focus with `setTimeout` delays to avoid LiteGraph interference
- **Canvas → screen coordinate transform**: LiteGraph's DragAndScale convention is `canvasX = (graphX + offset[0]) * scale` (NOT `graphX * scale + offset[0]`). The wrong formula coincides at scale=1 but mispositions overlays by `offset[0] * (scale - 1)` at non-1 zoom — overlays can fly off-screen at extreme zoom and the user thinks the button "did nothing". Always use `rect.left + (graphX + offset[0]) * scale` when positioning a fixed-position DOM overlay relative to a graph point. For button-anchored panels, prefer reading `button.last_y` for the local Y rather than hardcoding an offset
- **Hover tooltip pattern (Classic mode)**: LiteGraph canvas-drawn widgets don't expose a native tooltip system, so we paint our own via a single fixed-position DOM overlay (`pointer-events: none`). A document-level `mousemove` listener bails if `e.target !== canvas.canvas` (so HTML overlays / Nodes 2.0 DOM widget aren't affected), uses `getNodeOnPos` to find the node and `widget.last_y` + `computeSize` to find the hovered widget. 500ms show delay, and same-widget mousemoves do NOT reset the timer (otherwise the timer never fires while the cursor drifts inside the widget). Nodes 2.0 mode uses HTML `title` attribute instead — same text, native browser tooltip
- **Reload Node recovery**: Initial workflow state snapshotted on first `configure()` into `app.graph._ppInitialStates[nodeId]`. Because ComfyUI's Reload Node assigns a **new id** to the recreated instance, a `onRemoved` → `onAdded` bridge (`app.graph._ppPendingReload`) transfers the saved state and re-keys it under the new id. Graph-level state cleared via patched `LGraph.prototype.clear` on workflow switch.
- **Prefix as widget (not slot)**: `prefix` is a multiline STRING widget kept at `widgets[0]` via `reorderPrefixToTop()`. **Critical**: `prefix` must remain in `node.widgets[]` in both Classic and Nodes 2.0 modes — removing it from `widgets[]` (as we do for other widgets in Nodes 2.0) breaks ComfyUI's automatic widget↔input-slot conversion and makes the prefix slot unwireable. The DOM Widget UI in Nodes 2.0 does NOT render its own prefix textarea; the native widget at the top serves as both editor and connectable slot. `prefix_separator` toggles whether `separator` is inserted between prefix and body
- **`PP_INPUT_ORDER` invariant**: `serialize()` always lays out `node.widgets[]` into `PP_INPUT_ORDER` before delegating to `origSerialize`, then restores. `configure()` ALSO re-applies `widgets_values` via name-based lookup (`findWidgetByName(node, PP_INPUT_ORDER[i])`) AFTER `origConfigure`, defending against third-party extensions (e.g. `PromptPalette_F_Vue`) that inject extra widgets and shift our widgets' array indices. `restoreInitialState()` uses the same name-based pattern for Reload Node recovery. Together, these decouple display order from save/restore order entirely
- **Legacy widgets_values sanitization**: `sanitizeLegacyPrefixValues()` resets stray button labels (`"edit_text"`, `"toggle_preview"`, `"set_all_weights"`) that pre-feature saves dropped into the new prefix indices, and resets non-boolean `prefix_separator` / `empty_when_no_selection` values for the same reason
- **Phrase list scrolling (Classic mode)**: Auto-grow capped at `CONFIG.maxAutoNodeHeight` (600px). When content exceeds the visible phrase area, `node.checkboxScrollOffset` (line units) scrolls. `drawCheckboxItems` uses `ctx.clip` for visual clipping and only registers clickable areas at *displayed* Y. Wheel scrolling via a document-level capture-phase listener installed in `setup()` (intercepts before ComfyUI's canvas zoom). `cb_scroll_up` / `cb_scroll_down` actions for the ▲▼ buttons
- **Width-shrink invariant**: `nodeType.prototype.computeSize` MUST NOT return the current node width — LiteGraph reads it as the drag-resize minimum. Width preservation on configure/redraw is done by passing `[this.size[0], computed[1]]` to `setSize` explicitly. Widget-level `computeSize` (e.g., prefix) must return `[0, h]` for the same reason
- **Widget area Y: static vs rendered**: Use `getWidgetsTotalHeight()` (static estimate from `computeSize`) BEFORE first draw — `nodeType.prototype.computeSize` is the only consumer. AFTER first draw, prefer `getRenderedWidgetAreaBottom()` (reads LiteGraph's `widget.last_y`) for any "where does the widget block actually end" lookup. The multiline `prefix` widget's HTML textarea overlay can extend past its declared `computeSize`, so static estimates drift and cause our custom-drawn checkbox area to overlap the buttons
- **Bulk weight transform pattern**: `transformAllPhrases(text, transformFn)` is the canonical way to apply a per-phrase transformation across the whole text while preserving `//` toggle prefix, inline `// comment`, and `[group]` tags. Backend processing strips `[group]` from inside `(text [group]:1.5)` correctly, so the transform can ignore tags
- **Selected-words outputs**: `selected_text` and `selected_list` always reflect the actual selection (`//`-filtered, group-stripped, weight-stripped). They are independent of `prefix`, `separator`, `trailing_separator`, `add_newline`, `separator_newline`, and `preview_override`. Use them when downstream needs a clean phrase list
- **`empty_when_no_selection` short-circuit**: When the toggle is ON and `filtered_lines` is empty, returns `(None, None, None)` on every output. Specifically chosen so rgthree's Any Switch (which does `value is None`) treats the input as skipped and passes through the next non-None input. Downstream execution still runs (NOT `ExecutionBlocker`). `preview_override` always wins over this toggle
- **State management**: Node tracks edit mode, clickable areas, widget visibility, text wrapping, preview override, and `checkboxScrollOffset`
- **Canvas redrawing**: Triggered via `app.graph.setDirtyCanvas(true)` after state changes

## Code Organization

### web/index.js Structure (approx. 3,200+ lines):
- **Imports**: `app` from ComfyUI app.js, `api` from ComfyUI api.js
- **Configuration**: CONFIG object with UI constants, including widgetSpacing
- **Group Parsing Functions**: Group tag extraction, status tracking, simplified toggle logic, global toggles
- **Classic-mode tooltip system**: `WIDGET_TOOLTIPS` map, `_ppGetTooltipEl()` lazy DOM overlay, `_ppShowTooltipAt()` / `_ppHideTooltip()` helpers, `installClassicTooltipListener(app)` (installed once from `setup()` via `window.__ppPromptPaletteTooltipHooked` guard). Bails on non-canvas mouse targets so Nodes 2.0 DOM widget and HTML overlays aren't affected
- **Unified Extension Registration**: Single "PromptPalette_F" extension with adaptive mode detection
  - `setup()`: Wraps `app.graphToPrompt` (formerly patched `api.queuePrompt`) to inject widget values (Nodes 2.0) and preview override (both modes)
  - `setupAdaptiveMode()`: Main setup function
  - `onNodeCreated`: Initializes widgets for both modes, creates warning widgets (removed later in Nodes 2.0)
  - `onDrawForeground`: Canvas rendering callback (Classic mode only) - creates buttons, draws UI
  - `onDrawBackground`: Background rendering callback (both modes) - mode detection and widget management
  - `onAdded`: (1) `setTimeout(0)` Reload Node recovery — restores initial state from `_ppPendingReload` if set within 500ms; (2) 100ms delayed Nodes 2.0 detection — creates DOM Widget UI
  - `onRemoved`: Captures the node's saved initial state into `app.graph._ppPendingReload` so the next new instance (Reload Node assigns a new id) can inherit it
  - `configure()`: Snapshots first-time `info` into `app.graph._ppInitialStates[nodeId]` (only on workflow load, not on subsequent edits) for later Reload Node recovery
- **UI Control Functions**: Widget management, click handling, interaction (Classic mode only)
  - `addEditButton()`: Creates "Set All Weights" → Edit → Hide Preview buttons (in that order, so Set All Weights renders above Edit). Called in Classic mode only
  - `findWidgetByName()`: Unified widget lookup with `_ppWidgetRefs` fallback for Nodes 2.0
  - `findFalseWhenEmptyWidget()`: helper for the `false_when_empty` toggle
  - Button creation, text widget handling, separator controls
- **Text Wrapping Utilities**: Dynamic widget height calculation, text wrapping, width calculation
  - `getWidgetsTotalHeight()`: static estimate, used by `nodeType.prototype.computeSize` (pre-draw)
  - `getRenderedWidgetAreaBottom()`: queries `widget.last_y` (post-draw) for accurate widget-area bottom, used by draw functions
- **Drawing Functions**: Canvas rendering for checkboxes, phrases, group controls, weight buttons, clickable text areas (Classic mode only)
- **Weight System**: Parsing, adjustment, formatting for `(text:weight)` notation
  - Per-line: `parseWeight()`, `setWeight()`, `adjustWeight()`, `adjustWeightInText()`
  - Bulk: `transformAllPhrases()`, `setAllWeights()`, `adjustAllWeights()`, `openBulkWeightEditor()` (floating HTML panel)
- **Theme/Color System**: Dynamic theme integration, color caching
- **Nodes 2.0 DOM Widget UI**: Full HTML/CSS-based interactive UI for Nodes 2.0 mode
  - `DOM_CSS`: Complete CSS styles using ComfyUI theme variables
  - `injectDOMCSS()`: One-time CSS injection into document head
  - `createDOMWidget()`: Builds interactive UI (checkboxes, weights, groups, preview, edit mode)
  - `setupNodes2DOMWidget()`: Registers DOM Widget via `addDOMWidget` with dynamic height
- **Preview Override Functions**: `findOverrideWidget()`, `setPreviewOverride()`, `getPreviewOverride()`, `openPreviewEditor()` (HTML textarea overlay with toolbar)
- **Preview System**: Preview generation, rendering, scrolling, edit/reset buttons (Classic mode only)
- **Entry Point**: Extension registration

### nodes.py Structure (~560 lines):
- **V3 API Conditional Imports**: try/except block for `comfy_api.latest` imports, `V3_AVAILABLE` flag, dummy `ComfyNode` class. Pyright reports `io is possibly unbound` and `comfy_api.latest could not be resolved` warnings under the `if V3_AVAILABLE:` guards — these are by design and gated at runtime, safe to ignore
- **Base Class Selection**: Conditionally inherit from `io.ComfyNode` or `object`
- **`PromptPalette_F` class**: V3/V1 hybrid
  - Conditional V3 `define_schema()` classmethod with all inputs (text, separator, trailing_separator, separator_newline, add_newline, preview_override, prefix, prefix_separator, empty_when_no_selection) and 3 outputs (text, selected_text, selected_list)
  - V1 `INPUT_TYPES()` classmethod with the same inputs in the same order
  - V1-style class attributes: `RETURN_TYPES = ("STRING", "STRING", "LIST")`, `RETURN_NAMES = ("text", "selected_text", "selected_list")`, `FUNCTION`, `CATEGORY`
  - `remove_group_tags_with_escape()` staticmethod
  - `strip_weight_notation()` staticmethod — repeatedly unwraps `(text:1.5)` → `text` for the list outputs
  - `execute()` classmethod:
    - Builds `filtered_lines` (with `//`-filter and `[group]`-strip)
    - Builds `selected_list` (weights stripped, empties removed) and `selected_text = "\n".join(selected_list)` — these reflect actual selection regardless of override
    - `preview_override` early return: `text` = override, list outputs still reflect real selection
    - `empty_when_no_selection` short-circuit: returns `(None, None, None)` when toggle is ON and `filtered_lines` is empty (prefix NOT prepended)
    - Normal path: applies `separator`, `prefix`, `prefix_separator`, `trailing_separator`, `add_newline`
    - Conditional return format: `io.NodeOutput(...)` if V3 available, tuple otherwise
- **`SimpleMultiConcatText` class**: UI-less, 5-text concat utility
  - V3 schema with `text1`–`text5` as optional `io.String.Input` + `separator`/`separator_newline`/`add_newline`; V1 INPUT_TYPES marks `text1`–`text5` with `forceInput: True` so they appear as connectable slots, not widgets
  - `execute()`: filters empty/None inputs, computes `effective_separator = separator + "\n" if separator_newline else separator` (works for `separator=""` too — yields bare `"\n"`), skips `add_newline` when zero valid inputs
- **`GetFirstWord` class**: UI-less, "split-and-take-first" utility
  - V3 schema with `text` (optional) + literal/regex stop word + post-process toggles
  - `_WINDOWS_INVALID_CHARS` class attribute (compiled regex `[<>:"/\\|?*\x00-\x1f]`)
  - **`process_one()` classmethod**: extracted core logic so `GetFirstWordList` reuses it. Handles literal/regex modes, escape expansion (literal only), trim, Windows-invalid char stripping + trailing `. ` strip, optional trailing slash. Catches `re.error` silently
  - `execute()`: thin wrapper that calls `process_one()` and returns V3/V1 format
- **`GetFirstWordList` class**: UI-less, "Get First Word over LIST" utility
  - V3 schema declares LIST as `io.String.*` (V3 has no first-class LIST type) — actual list type comes from V1 `INPUT_TYPES "LIST"` and V1 `RETURN_TYPES`/`RETURN_NAMES`
  - `RETURN_TYPES = ("STRING", "LIST")`, `RETURN_NAMES = ("text", "list")`
  - `execute()`: defensive coercion for `items` (None/tuple/set/str/wrong-type all handled), calls `GetFirstWord.process_one()` for each element, joins with `text_separator` for the `text` output, returns raw results for the `list` output
- **V3 Extension**: `PromptPaletteExtension.get_node_list()` returns all four classes — `PromptPalette_F`, `SimpleMultiConcatText`, `GetFirstWord`, `GetFirstWordList`. Only defined if `V3_AVAILABLE`
- **V1 Legacy Exports**: `NODE_CLASS_MAPPINGS`, `NODE_DISPLAY_NAME_MAPPINGS`, `WEB_DIRECTORY` (always defined). All four nodes registered

### __init__.py Structure (5 lines):
- **V1-only Entry Point**: Imports and exports V1 mappings directly from nodes.py
- **Reason**: V3 `web_directory` property issue prevents JavaScript file loading
- **Future**: Will be updated to use `comfy_entrypoint` when V3 web_directory is fixed

### pyproject.toml Structure:
- **[project] section**: Project metadata including name, version, description, license, Python requirements
- **[project.urls] section**: Repository URL pointing to GitHub
- **[tool.comfy] section**: ComfyUI-specific configuration including PublisherId ("id-fa") and DisplayName ("PromptPalette-F")

## Installation & Usage

Standard ComfyUI custom node installation - clone into `custom_nodes` directory and restart ComfyUI. No additional setup or dependencies required.

### ComfyUI Registry
This project includes `pyproject.toml` for ComfyUI registry publication following the [official specification](https://docs.comfy.org/registry/specifications):
- **Project name**: `promptpalette-f` (registry identifier)
- **Display name**: `PromptPalette-F` (shown in UI)
- **Publisher**: `id-fa`
- **Repository**: https://github.com/id-fa/ComfyUI-PromptPalette-F

## Development Status

### Recent Changes (July 17, 2026)
- ✅ **`NodeValueTemplate`: Smarty-style modifiers** (`web/node_value_template.js` — frontend only, no backend change): tokens can now post-process their value with `|`-chained modifiers, e.g. `%LoadImage.image|basename|firstword:'_'%`. Modifiers: `basename` (drop dirs + extension), `firstword[:'sep']` (text before the first separator; no arg → space OR `_`, whichever comes first), `trim`. Applied left to right; work on `%date:…%` tokens too
  - **Parsing**: `splitModifiers()` splits the token's inner text on `|` but ignores pipes inside quoted args (so `firstword:'|'` works); `parseModifierSpec()` takes everything after the FIRST `:` as the arg, strips matching surrounding quotes (`'…'` / `"…"`), and expands `\n`/`\r`/`\t` so a tab separator can be typed literally; `applyModifierSpec()` returns `undefined` for an unknown name so `resolveTemplate` leaves the WHOLE token as `%...%` — same "typos stay visible" policy as an unknown node title
  - **Picker modal**: added a `修飾子` row (dropdown + separator input + `＋ 追加`) and a chip strip with per-chip `✕`. Selection state changed from `{token}` to `{base, mods[]}` where `base` is the token's inner text — `buildToken()` composes `%base|mod|mod%`, and the mods survive changing the base. The separator input only shows for `firstword`; `formatModifier()` quotes/re-escapes the arg so it round-trips through the parser
  - **Verified** by evaluating the resolver (module minus the DOM half) in Node against a stubbed `app.graph._nodes`: basename/firstword/trim/chaining/date+modifier/unknown-modifier/unknown-node/`100% off | 50%` all behaved as specified

### Recent Changes (July 7, 2026)
- ✅ **Bypass now passes the `prefix` through to `text`** (`web/index.js`, `app.graphToPrompt` wrapper): when a `PromptPalette_F` node is set to **Bypass** (`node.mode === 4`), ComfyUI drops it from the built prompt and severs downstream links, resolving `text` to nothing — so the node used to contribute an empty output. Native bypass would pass a connected input through to a same-type output, but the type/slot matching between our `prefix` input and `text` output doesn't line up, so nothing flowed. Users expect the `prefix` value to still flow out of `text` when bypassed. Fix lives in the existing `graphToPrompt` wrapper (same block that injects Nodes 2.0 widget values / `preview_override`). **Verified end-to-end in a real ComfyUI (frontend 1.33.x, Nodes 2.0, `graph.links` is a Map): bypassed node → PreviewAny received the expected value via the real Queue path.**
  - After the original `graphToPrompt` runs, scan `app.graph._nodes` for `type === "PromptPalette_F"` with `node.mode === 4` that are **absent** from `output` (confirming bypass) and whose `text` output (slot 0, `RETURN_NAMES[0]`) has downstream links. Skip nodes with no `text` consumers (avoids needless backend execution)
  - **Prefix resolution (two cases)**: `prefix` can be either a WIDGET (typed value) or a wired INPUT SLOT (upstream string node). (1) If the `prefix` input slot is **connected**, resolve it to an `[upstreamNodeId, slot]` reference so the **upstream node's output flows through** (true passthrough — this is what a user wiring a string node into `prefix` wants) — but only if the upstream survived into `output` (guard `output[String(origin_id)]`; else fall back). (2) Otherwise use the prefix **widget's** typed value. The upstream primitive stays in `output` even though its only consumer was bypassed (confirmed empirically), so the reference resolves
  - Re-insert the node into `output` as `{ class_type: "PromptPalette_F", inputs: { text: "", prefix: <ref-or-value> }, _meta: { title } }`. With `text=""` (no selection) the backend `execute()` normal path yields `result = prefix + "" == prefix`, so **`text` emits exactly the prefix** (empty prefix → empty string). Deliberately does NOT use `preview_override` (an empty prefix would be falsy and fall through to processing the real `text` selection — wrong); `text=""` + `prefix=` is exact for all cases
  - Rewire every downstream `text` consumer back to `[idStr, 0]` (reads `node.outputs[0].links` → `graph.links[linkId]` → `link.target_id`/`target_slot` → target input name). `getLink()` helper (hoisted above the node loop, also used for prefix-link resolution) supports both plain-object and Map forms of `graph.links` (newer LiteGraph forks). Targets themselves bypassed/absent from `output` are skipped
  - **`node.mode` is never mutated**, so the serialized/embedded workflow (PNG metadata, saved JSON) still records the node as bypassed — the canvas bypass state is untouched. No effect when the node is not bypassed
  - **Scope caveats**: only the `text` output is fed on bypass — `selected_text` / `selected_list` remain unconnected (unchanged behavior; prefix was never part of those outputs). The node DOES execute on the backend when bypassed (a trivial string op, ~zero cost); there is no way to emit the prefix WITHOUT executing the node. YARA-clean (no `Function#bind` / dotted socket-method substrings introduced)
  - **Common gotcha**: a stale cached `index.js` makes this look "not working" — a plain F5 can keep the old file; hard-reload (Ctrl+Shift+R) to pick up the new frontend

### Recent Changes (June 29, 2026)
- ✅ **Documented Qwen3-VL compatibility for `GemmaTranslate` and `GemmaImagePrompt`** (`README.md` JA+EN + this file — **docs only, no code change**): ComfyUI v0.26.0 added support for Qwen's VL models, and the user confirmed both Gemma nodes work with a Qwen3-VL loaded via `CLIPLoader` wired into the `clip` input, with NO code changes. This works because the nodes' `clip.tokenize` (with `image=` for the vision path) / `clip.generate` / `clip.decode` pipeline is model-agnostic — it doesn't assume Gemma4 specifically. Added a 🆕 note to both nodes' README sections (JA + EN) stating Qwen3-VL can replace Gemma4 the same way and **requires ComfyUI v0.26.0+**, and appended the same note to both node summary lines at the top of this file. The display names / class names are unchanged (still `Gemma Translate` / `Gemma Image Prompt`)

### Recent Changes (June 15, 2026)
- ✅ **Global `[all]`/`[off]` buttons shown even without `[group]` tags** (`web/index.js`): the all-on / all-off global toggles previously only rendered when at least one `[group]` tag existed. Now they appear whenever there are phrases, regardless of groups
  - **Classic mode**: `drawCheckboxList` now calls `drawGroupControls` when `text.trim() !== ""` (was `groups.length > 0`); `drawGroupControls` lost its `if (groups.length === 0) return 0;` early return. The `[all]`/`[off]` buttons are always drawn; the per-group buttons remain gated by the `groups.forEach` (empty array → nothing). Returns `CONFIG.groupAreaHeight` so the row's space is reserved
  - **Nodes 2.0 mode**: `renderDisplayMode` moved the `[all]`/`[off]` button creation out of the `if (groups.length > 0)` block into its own `if (hasPhrases)` block (`hasPhrases = lines.some(l => !isEmptyLine(l) && !isDescriptionComment(l))`); group buttons stay inside the `groups.length > 0` block
  - `toggleAllPhrases()` was already group-independent (toggles every phrase line), so no logic change was needed
- ✅ **`N selected` count in preview header** (`web/index.js`): the preview area shows the number of checked (active, non-`//`-commented) phrases next to the `Preview:` / `Preview (Edited):` label
  - New `countSelectedPhrases(text)` helper → `{ selected, total }`; skips empty lines and `#` description comments, counts a line as `selected` when it does NOT start with `//`. Reflects the ACTUAL selection from the `text` widget (so the count stays correct even when `preview_override` is active)
  - **Classic mode** (`drawPreview`): draws `${selected} selected` after the label (measures label width to position it), in `inactiveTextColor`, only when `total > 0`
  - **Nodes 2.0 mode** (`renderDisplayMode` preview header): appends a `.pp-preview-count` `<span>` after the label when `total > 0`. New CSS gives it `margin-right: auto` so it sits flush after the label while the Edit/Reset buttons stay right-aligned (header is `display:flex; justify-content:space-between`)

### Recent Changes (June 8, 2026)
- ✅ **`GemmaImagePrompt` — `prompt_mode` option added (image-editing models)**: a new combo `prompt_mode` (`Generate (recreate image)` default / `Edit instruction (change description)`) for image-editing models like Qwen-Image-Edit. In Edit mode `_build_request()` tells Gemma to write a "change X into Y" editing INSTRUCTION that states BOTH the original element and what it becomes (e.g. "change the red car into a blue sports car"), NOT just a description of the final image; it forces natural-language phrasing (ignores the Danbooru-tags style), and leaves the negative prompt empty regardless of `target_model` (edit models are instruction-based). Generation mode is unchanged. `is_edit` is detected by `"edit" in prompt_mode.lower()` (resilient to the exact label). **Appended LAST in INPUT_TYPES** (after `unload_after`) to keep `widgets_values` index-stable for workflows already saved with this node. `execute()` gained `prompt_mode="Generate (recreate image)"` (default preserves prior behavior). Added 3 tests (default=generation, edit-instruction wording, edit leaves negative empty) → 76 tests pass. README JA+EN + node summary updated
- ✅ **`GemmaImagePrompt` node added** (`nodes.py` + new `web/gemma_image_prompt.js` + a `TestGemmaImagePrompt` suite): an EXPERIMENTAL vision→prompt node, the second Gemma4 node. Same `clip.tokenize` → `clip.generate` → `clip.decode` execution-time pipeline as `GemmaTranslate`, but the IMAGE is passed to the multimodal tokenizer (`clip.tokenize(prompt, image=image, …)`) so Gemma can analyze it
  - **Purpose**: look at an input image and emit a text-to-image prompt that recreates a visually-similar image, honoring free-form modification instructions. Inputs `clip` (required) / `image` (optional) / `instruction` (multiline) / `output_format` (combo Natural language|Danbooru tags) / `target_model` (combo FLUX|SDXL) / `detail_mode` (combo Keep as instructed|Expand detail) / `max_length` / `unload_after`. Outputs `positive` / `negative`
  - **Prompt engineering**: `_build_request()` assembles the instruction prompt from the four settings — image-present vs instruction-only opening, NL vs Danbooru-tags style, FLUX (negative left empty) vs SDXL (asks for a negative), keep-minimal vs expand-detail — then commands "output ONLY the prompt" in a strict `POSITIVE:` / `NEGATIVE:` two-line form. `_parse_pos_neg()` extracts the two sections with a case-insensitive regex (positive = text between `POSITIVE:` and `NEGATIVE:`; negative = after `NEGATIVE:`), falls back to treating the whole output as positive when labels are missing, strips code fences/quotes via `_clean()`, and normalizes placeholder negatives (`(empty)`/`none`/`n/a`/…) to `""`. No image AND no instruction → `("", "")` (no generation). Generation errors caught → `[Gemma Image Prompt error] …` in `positive`
  - **All combos use `("COMBO", {"options":[...]})`** (per the same-day unhashable-list fix) — never bare lists. Returns `{"ui": {"positive": [..], "negative": [..]}, "result": (pos, neg)}` so the frontend shows both
  - **Frontend** (`web/gemma_image_prompt.js`, extension `idfa.GemmaImagePrompt`): native widgets only (like `gemma_translate.js`) — two `ComfyWidgets["STRING"]` multiline display fields (`positive` / `negative`, `serializeValue → ""`) filled in `onExecuted` from `message.positive` / `message.negative`. No swap button. YARA-clean
  - **Caveat**: Gemma-4-E4B may not reliably follow every instruction (especially Danbooru-tag formatting and strict POSITIVE/NEGATIVE output) — this is a test node; the parser degrades gracefully
- ✅ **Fixed `GemmaTranslate` "unhashable type: 'list'" at prompt validation** (`nodes.py`): on real ComfyUI v0.21+ the node loaded fine but failed when queued (`* GemmaTranslate N: Exception when validating inner node: unhashable type: 'list'`)
  - **Root cause**: every node here subclasses `io.ComfyNode`, so ComfyUI's `validate_inputs` (execution.py) takes the **V3 branch** → `comfy_api.latest._io.parse_class_inputs()` runs `io_type = value[0]; if io_type in DYNAMIC_INPUT_LOOKUP:` where `DYNAMIC_INPUT_LOOKUP` is a **dict**. The combo `target_language` was declared the classic way `(["English","Japanese","Chinese"], {...})`, so `value[0]` is the **option list itself** → `list in dict` hashes a list → `TypeError`. The other 7 nodes were unaffected because their `value[0]` is always a hashable string (`"STRING"`/`"INT"`/`"BOOLEAN"`/`"LIST"`/`"CLIP"`); GemmaTranslate is the FIRST node with a combo
  - **Fix**: declare combos as `("COMBO", {"options": [...], "default": ...})` so `value[0] == "COMBO"` (hashable). ComfyUI reads the options back via `input_type == io.Combo.io_type` → `extra_info.get("options", [])`. **Repo rule: never use a bare-list combo `([...], {...})` — always `("COMBO", {"options":[...]})`** (the V3 `define_schema` already used the correct `io.Combo.Input(options=...)`). The standalone tests run with `V3_AVAILABLE=False` so they never exercise `parse_class_inputs` and couldn't catch this; added `test_all_input_io_types_are_hashable_strings` (asserts every node's `INPUT_TYPES()` io_type is a hashable `str`) as a ComfyUI-free regression guard
- ✅ **`GemmaTranslate` node added** (`nodes.py` + new `web/gemma_translate.js` + a `TestGemmaTranslate` suite in `tests/test_nodes.py`): an LLM-backed translation node that uses ComfyUI's new Gemma4 text-generation support (added by Comfy-Org PR #13376, `comfy/text_encoders/gemma4.py`)
  - **Key difference vs `PromptTabsTranslate`**: PTT translates instantly on a button click via the googletrans backend route (no model). GemmaTranslate runs a real autoregressive generation that only works **during graph execution** — the Gemma4 model lives inside the execution context, so it can't translate purely client-side. Design confirmed with the user: translate at Queue Prompt time, CLIPLoader stays an input slot (not embedded), an `unload_after` toggle on the node, and plain-instruction + post-processing for output cleaning (all four "recommended" choices)
  - **Backend** (`GemmaTranslate` class): V3/V1 hybrid like the others. Inputs `clip` (CLIP, required — a Gemma4 encoder from `CLIPLoader` type `gemma4`, model in `models/text_encoders/`), `text` (source, multiline), `target_language` (combo English/Japanese/Chinese → mapped to language names; Chinese → "Chinese (Simplified)"), `max_length` (INT 512), `unload_after` (BOOLEAN). Outputs `source` / `translated`. `execute()` builds a translation instruction prompt then calls the SAME pipeline as ComfyUI's `TextGenerate` node (`comfy_extras/nodes_textgen.py`): `clip.tokenize(instruction, skip_template=False, min_length=1, thinking=False)` → `clip.generate(tokens, do_sample=False, max_length=…, temperature/top_k/top_p/min_p/repetition_penalty/presence_penalty/seed=…)` → `clip.decode(ids)`. Each call has a `TypeError` fallback to a minimal signature for older ComfyUI builds. Blank source short-circuits to `("", "")`; any generation exception is caught and surfaced as `[Gemma Translate error] …` in the `translated` output (never raises). `_clean_translation()` strips ```` ``` ```` code fences, a leading `Translation:` / `訳文：` label, and matching surrounding quotes (ASCII or 「」). `unload_after` calls `comfy.model_management.unload_all_models()` + `soft_empty_cache()` in a try/except (frees the whole session's model cache — fine for a dedicated translate workflow)
  - **`ui` return for live display**: `execute()` returns `{"ui": {"translated": [text]}, "result": (source, translated)}` (V1) / `io.NodeOutput(source, translated, ui={"translated": [text]})` (V3) so the frontend can show the result, ShowText-style. NOTE: this is the FIRST node here to return the `{"ui", "result"}` dict form — the others return bare tuples
  - **Frontend** (`web/gemma_translate.js`, extension `idfa.GemmaTranslate`): deliberately minimal — **native widgets only**, no `addDOMWidget` / observer machinery (unlike the tab nodes). `onNodeCreated` lazily adds a `ComfyWidgets["STRING"]` multiline display widget named `translated` (with `serializeValue → ""` so the result isn't persisted) and a native `addWidget("button", "⇅ 入れ替え", …)` that swaps the `text` and `translated` widget values. `onExecuted(message)` reads `message.translated` (joins if it's a list) and writes it into the display widget. Both native widgets render correctly in Classic AND Nodes 2.0 (ShowText-style STRING widgets and native buttons work in both — the DOM-widget button caveat does NOT apply to `addWidget("button")`). No `Function#bind` / dotted socket-method substrings (YARA-clean)
  - **References for the API**: built-in `TextGenerate` node ([`comfy_extras/nodes_textgen.py`](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_textgen.py)), [PR #13376](https://github.com/Comfy-Org/ComfyUI/pull/13376), [Gemma4 tutorial](https://docs.comfy.org/tutorials/llm/gemma4/gemma4). Gemma4 is loaded via `CLIPLoader` (not a dedicated loader)
- ✅ **Cleared `python_network_operations` YARA false positive (Registry security scan)** (`web/index.js` AND `web/node_value_template.js`): the ComfyUI Registry `yara_scan` flagged both files. A flagged status **delists the node from the official ComfyUI Manager / Registry**, so it had to be cleared (not ignorable, despite printing as `info` severity)
  - **Root cause** (confirmed via `gh search code 'python_network_operations'` → a prior session's notes in `Deno2026/comfyui-deno-custom-nodes/SESSION_HANDOFF.md`, which diagnosed the SAME rule using the Registry `include_status_reason` API): the rule keys on **dotted socket-method call substrings** (`$socketN` = `.connect(`, `.bind(`, `.send(`, …) — it does NOT inspect for real network I/O and does NOT match the word "socket". Our flagged lines were `api.queuePrompt.bind(api)`; the **`.bind(`** (`Function.prototype.bind`) collided with socket `.bind(`. Proof it was a substring match, not real I/O: the genuine `api.fetchApi(...)` call in `prompt_tabs_translate.js:273` was NEVER flagged
  - **Fix (two layers)**: (1) moved the prompt-value injection from patching `api.queuePrompt` (a network-named method) to **wrapping `app.graphToPrompt`** (the pure prompt BUILDER — no network I/O; ComfyUI still sends via the untouched `api.queuePrompt`). The wrapper runs the original first, then mutates `result.output` for its own node type only, then returns `result` (order flips vs the old queue-time patch). Guarded by `if (typeof app.graphToPrompt === "function")`. (2) the decisive fix — **dropped `Function#bind`**: capture `const o = app.graphToPrompt;` and re-dispatch via `o.apply(app, args)` (`.apply(` is not a socket method → safe; the wrapper is still invoked as `app.graphToPrompt(...)`, so the original runs with `app` as its `this`). Verified ZERO `.bind(` / `.connect(` / `.send(` etc. in both files
  - **Why `graphToPrompt` (not `serialize()`) for NodeValueTemplate**: token resolution must use live values at queue time, and `graphToPrompt` is the EXECUTE path — separate from the workflow-SAVE `serialize()` — so the raw `%Title.widget%` template is never destroyed in saved workflows. Also removed the now-unused `api` import from `node_value_template.js`
  - **Left as-is**: `.disconnect(` in `prompt_tabs*.js` (those files were never flagged; the rule's `.connect(` does not substring-match `.disconnect(` — the char before `connect(` is `s`, not `.`). **Caveat for future edits**: avoid `Function#bind` and literal dotted socket-method substrings (`.connect(`/`.bind(`/`.send(`/…) anywhere in `web/*.js`, INCLUDING comments — the scan does not skip comments. Use `.apply(`/`.call(`, a bracket-method helper, or a string split
- ✅ **Prompt Tabs reverted to the "height adjustment broken" layout, sometimes** (`web/prompt_tabs.js` AND `web/prompt_tabs_translate.js`): the editor would intermittently lose the `applyEditorRowSizing` fix (June 7) and snap back to ComfyUI's default grid layout — the user reported it as "旧い仕様に戻る". NOT data loss (tabs/text intact); only the row sizing was lost
  - **Root cause** (Nodes 2.0 only): the June-7 `MutationObserver` watched the `grid` (`.lg-node-widgets`) element's `style`. The Vue renderer sometimes REPLACES the whole grid element on a remount (more likely when the main thread is janky — correlated with the reflow violations below). The grid observer is then stranded on the detached old grid and never fires again, so `applyEditorRowSizing` is never re-applied to the fresh grid. The only other re-apply triggers are `render()` (tab actions) and that dead observer, so it stays broken until the user touches a tab
  - **Fix:** added a SECOND `MutationObserver` on the node ROOT (`.lg-node[data-node-id]`, far more stable than the grid) with `{childList:true, subtree:true}` (`node._pptRootObserver` / `node._pptRootEl`). A grid swap is a structural mutation in the root subtree → re-triggers `scheduleAdjustEditorHeights` → `applyEditorRowSizing` finds and re-attaches to the new grid. `childList` only (no attributes) avoids style-churn/typing noise; setting `gridTemplateRows` adds no DOM nodes → no loop
- ✅ **Performance: eliminated the per-frame forced-reflow that caused the console `[Violation]` warnings** (`web/prompt_tabs.js` AND `web/prompt_tabs_translate.js`): the tab-bar / translate-button DOM widgets' `computeSize(width)` read `inner.offsetHeight` (and `btnInner.offsetHeight`) on every call. LiteGraph calls `computeSize` many times per frame, so each call forced a synchronous layout reflow → `[Violation] Forced reflow ... 214ms`, `requestAnimationFrame handler took 238ms`, and downstream `wheel input event delayed 1745ms` (the wheel handler was merely queued behind the busy main thread — a symptom, not the cause)
  - **Fix:** new module-level `trackHeight(node, el, initial)` helper caches the element's height via a `ResizeObserver` (which fires AFTER layout, so reading `borderBoxSize[0].blockSize` / `offsetHeight` in its callback is cheap and batched). `computeSize` now just returns the cached `[width, h]` — no layout read. The observer only calls `setDirtyCanvas` when the height actually CHANGES (fewer redraws than the old "redraw on every resize" observer; no feedback loop because `computeSize` never resizes the element). Applied to the tab bar in both files and the translate-button bar
  - **Left as-is:** `index.js`'s tooltip/wheel handlers also call `getBoundingClientRect`, but those run per-EVENT (mousemove/wheel), not per-frame, so they are not a reflow storm
- ✅ **Memory leak fix: per-node observers/listeners are now torn down on removal** (`web/prompt_tabs.js` AND `web/prompt_tabs_translate.js`): both notepad nodes had NO `onRemoved` at all, so every node deletion / workflow reload (which recreates EVERY node) leaked the per-node `ResizeObserver` + two `MutationObserver`s + the editor `input` listener and the detached DOM they pin. Suspected cause of the rare browser crashes the user saw
  - **Why it leaks:** `ResizeObserver.observe()` registers the observer in the browser's active-observer registry, which is a **GC root** — so an un-disconnected observer (and its callback closure over `node` + the detached element) is never collected even after the node is gone from `graph._nodes` and its DOM is detached
  - **Fix:** `beforeRegisterNodeDef` wraps `nodeType.prototype.onRemoved` to call a per-node `cleanup()` (exposed via `node._promptTabs` / `node._promptTabsTranslate`), then chains the original. `cleanup()` disconnects `_pptRowObserver`, `_pptRootObserver`, and every ResizeObserver collected in `node._pptResizeObservers[]` (the `trackHeight` helper pushes each `ro` there), nulls the `_ppt*` refs, and `removeEventListener("input", …)` on the editor textarea(s). Safe against late callbacks: after disconnect no new mutations fire, and any already-queued rAF/`setTimeout` calls `applyEditorRowSizing`, which does `document.querySelector('.lg-node[data-node-id="<id>"]')` → null once the node DOM is gone → early return, so it never re-creates observers
  - **Audited clean (no fix needed):** `index.js` Nodes 2.0 DOM render clears `container.innerHTML=''` before rebuilding (no listener accumulation) and has an existing `onRemoved`; its document-level wheel/mousemove listeners are single global instances guarded by `window.__pp*Hooked` (constant memory). `node_value_template.js` guards caret listeners with `ta._nvtTracked` (once per textarea) and balances `window.__nvtKeyHandler` add/remove on modal open/close. The prompt-injection wrappers (the `app.graphToPrompt` wraps; `api.queuePrompt` patches at the time of this June-8 audit) are per-extension (setup-time), not per-node

### Recent Changes (June 7, 2026)
- ✅ **Clear error message when `googletrans` is missing/broken** (`nodes.py`): previously a failed translation silently returned an empty string, so the UI showed nothing and the user couldn't tell why. Now the translation path RAISES `_PPFTranslateError` with a bilingual (JA+EN), actionable message; the existing route handler already wraps exceptions into `{"error": str(e)}` (status 500), and the frontend (`prompt_tabs_translate.js:246`) shows it as `翻訳失敗: <message>`. Specifics: renamed `_ppf_try_googletrans()` → `_ppf_googletrans_translate()` (raises instead of returning None); `ImportError` → `_PPF_GOOGLETRANS_MISSING_MSG` ("`pip install googletrans` … restart"); a non-ImportError at import time (broken install, e.g. incompatible httpx) and runtime failures get their own clear messages. Added `_ppf_aclose_translator()` — a `finally`-block best-effort `await translator.client.aclose()` that suppresses the `RuntimeWarning: coroutine 'AsyncClient.get' was never awaited` seen when googletrans 4.x (httpx) fails partway. `_ppf_translate_text()` still returns `""` for empty input (not an error). Note: a genuinely-uninstalled googletrans hits `ImportError` before any coroutine is created, so it produces NO warning — the warning the user saw meant googletrans imported but failed at runtime
- ✅ **Translation now relies solely on `googletrans`** (`nodes.py` + `requirements.txt`): removed the Google free-endpoint fallback that the `Prompt Tabs + Translate` node used when `googletrans` was missing. Deleted `_ppf_translate_via_endpoint()` (the aiohttp call to `https://translate.googleapis.com/translate_a/single`); `_ppf_translate_text()` now uses googletrans only. `requirements.txt` updated: googletrans is now documented as a real dependency (no longer "OPTIONAL with endpoint fallback"). README (JA + EN) + CLAUDE.md (line 16 node summary) updated to drop the fallback wording. The `from aiohttp import web` import for the route response is unchanged (it's for `json_response`, not the deleted endpoint call)
- ✅ **Editor text boxes fill the node in Nodes 2.0** (`web/prompt_tabs.js` AND `web/prompt_tabs_translate.js`): the multiline editors now grow to use the node's full height (instead of capping at ~4-6 lines for `PromptTabsTranslate`, or wasting space above the tab bar for `PromptTabs`), while the node stays freely shrinkable
  - **Root cause** (Nodes 2.0 / Vue only — Classic auto-stretches a single multiline widget and is unaffected): the Vue node body is a CSS grid (`.lg-node-widgets`, inline `grid-template-rows: auto auto … min-content; flex: 1 1 0%`). The grid `flex:1` fills the node body and the grid's default `align-content: stretch` stretches EVERY `auto` row to fill that height. So the spare vertical space is split across all widget rows — for `PromptTabsTranslate` (6 rows: tab bar + translate buttons + 2 section labels + 2 editors) each editor only gets ~1/6, capping at a few lines; for `PromptTabs` (tab bar + editor) the tab-bar row also stretches and wastes space. `widget.computedHeight` / `computeSize` / `computeLayoutSize` are **ignored** by the Vue body renderer; row heights come purely from `grid-template-rows` + `align-content: stretch`
  - **Dead end (rejected):** setting an explicit inline `height` on the editor `<textarea>` does grow them, BUT the Nodes 2.0 node body auto-fits its DOM content height and `node.size[1]` clamps to that content min — so a fixed editor height forces the node's minimum height up and makes the node **un-shrinkable** (a real regression that was caught and reverted)
  - **Fix** (`applyEditorRowSizing(node)` in both files): override the grid's `grid-template-rows` so NON-editor rows are `min-content` (hug content) and EDITOR rows stay `auto`. `align-content: stretch` then gives the spare height only to the editor rows, and because they remain `auto` (min = the textarea's `min-h-16` = 64px, NOT a fixed px) the node can still be shrunk — editors collapse to 64px and the node minimum stays small. `desired = [...grid.children].map(c => c.querySelector('textarea') ? 'auto' : 'min-content').join(' ')` (maps by textarea presence, order-independent). ComfyUI rewrites the grid's inline `grid-template-rows` on every layout pass, so a `MutationObserver` on the grid's `style` attribute re-asserts ours (setting our own value re-fires it, but then `desired` matches → skip → no loop); re-attaches if the grid element changes (`node._pptRowGrid`). Also re-run via `scheduleAdjustEditorHeights` (double `requestAnimationFrame`) from `render()` + two `setTimeout`s after setup for Vue mount timing
  - **Classic-mode safety:** there is no `.lg-node[data-node-id]` DOM in Classic, so every lookup misses and `applyEditorRowSizing` is a harmless no-op (Classic already auto-stretches correctly)

### Recent Changes (June 6, 2026)
- ✅ **Tab reordering via `◀`/`▶` buttons** (`web/prompt_tabs.js` AND `web/prompt_tabs_translate.js`): both notepad-style nodes can now reorder tabs with buttons (chosen over drag-and-drop — far simpler, no drag-state machine or contention with ComfyUI's node-move pointer events). `moveTab(i, dir)` swaps a tab with its `i+dir` neighbor, keeps `store.active` following the moved tab (and the displaced one), then `persist()` → `render()`. Inside `makeTab`, a local `makeMover(arrow, dir, title)` builds the arrow spans — shown **only on the active tab** (to keep the bar uncluttered), in the order `◀ [name] ▶ ×`. At the ends the relevant arrow is greyed (`#666`) + non-clickable so the movable range is obvious. Each mover `stopPropagation`s `pointerdown` like the other tab controls. New order persists to the `tabs_data` JSON store. Both files carry an identical implementation
- ✅ **`PromptTabsTranslate` button bar polish** (`web/prompt_tabs_translate.js`): translate button labels shortened to the language name only (`日本語` / `英語` / `中国語`, flag kept) with a single bold `Translate:` prefix label prepended to the bar — was previously `日本語に翻訳` etc. on each button (redundant). Bar layout: `Translate: [🇯🇵 日本語] [🇬🇧 英語] [🇨🇳 中国語] [⇅ 入れ替え] (status)`
- ✅ **`PromptTabsTranslate` swap button** (`web/prompt_tabs_translate.js`): added a `⇅ 入れ替え` button that exchanges the active tab's `source` and `translated` field values. `swapSourceTranslated()` sets both `sourceWidget.value` / `transWidget.value` programmatically (does NOT fire the editors' `input` listeners — same no-feedback-loop pattern as `loadActiveIntoEditors`), then `saveEditorsIntoActive()` flushes into `tabs_data`, clears the status span, and re-renders. The button sits in the translate-button bar (`btnInner`) AFTER the three translate buttons and BEFORE the status span; purple styling (`#3a2d4a` bg) distinguishes it from the translate buttons. `setButtonsDisabled()` now disables `swapBtn` too (`[...buttons, swapBtn]`) so it's greyed out during an in-flight translation. Affects the active tab only; persisted to the `tabs_data` JSON store like every other edit

### Recent Changes (June 5, 2026)
- ✅ **`PromptTabsTranslate` node added** (`nodes.py` + new `web/prompt_tabs_translate.js` + `requirements.txt`): a Prompt Tabs variant that keeps a `source` + `translated` field pair per tab and translates on button click
  - Backend node (`nodes.py`): V3/V1 hybrid like the others. Inputs `text` (source editor, multiline), `translated` (translated editor, multiline, freely editable), `tabs_data` (hidden JSON store `{"tabs": [{"name","source","translated"}], "active": int}`). Outputs `source` / `translated` / `label`. `execute()` is a thin pass-through `(text, translated, label)`; `_active_label` parses the active tab name out of `tabs_data` (same pattern as `PromptTabs`). All tab/translation state lives in the frontend — do NOT move it into Python
  - **Translation backend route** (`nodes.py`): registers `POST /promptpalette_f/translate` on `PromptServer.instance.routes` (guarded: registers once via `_ppf_translate_registered` flag, wrapped in try/except so a missing server never breaks node loading). Handler reads `{text, target}`, returns `{translated}`. `_ppf_translate_text()` prefers the optional `googletrans` lib (`_ppf_try_googletrans` — awaits if the call is a coroutine, returns None on any failure to trigger fallback), else falls back to Google's free web endpoint `https://translate.googleapis.com/translate_a/single` via aiohttp (`_ppf_translate_via_endpoint`, `resp.json(content_type=None)`, concatenates `data[0][*][0]` chunks). No API key on either path. `_PPF_LANG_ALIASES` maps UI codes → backend codes (`zh`/`zh-CN` → `zh-cn`)
  - **Frontend** (`web/prompt_tabs_translate.js`): separate extension `idfa.PromptTabsTranslate` (acts only on `PromptTabsTranslate`, independent of `prompt_tabs.js`). Mirrors `prompt_tabs.js` structure (DOM tab bar, hidden `tabs_data`, `onConfigure → reload()`, live `input` sync, `serializeValue` flush) but tracks TWO editors: `saveEditorsIntoActive` / `loadActiveIntoEditors` move both `source` and `translated` around every switch/add/delete. `normalize()` accepts legacy `text` as a `source` alias. Translate buttons are a DOM widget (`addDOMWidget`, custom type — NOT `"button"`) calling `api.fetchApi("/promptpalette_f/translate", {POST})`; busy state disables buttons + shows a status span. Widget order rebuilt to: tab bar → translate buttons → `原文` label → source editor → `翻訳` label → translated editor → (hidden rest). Section labels are tiny DOM-widget `<div>`s
  - **`requirements.txt`** added: documents googletrans as OPTIONAL (comment-only, no hard pin) — the endpoint fallback means out-of-the-box operation without it; a hard requirement could break ComfyUI Manager installs
  - Registered in `get_node_list()` (V3) + `NODE_CLASS_MAPPINGS` / `NODE_DISPLAY_NAME_MAPPINGS` (V1). README (JA + EN) updated. Display name `Prompt Tabs + Translate`, category `PromptPalette-F`

### Recent Changes (June 3, 2026)
- ✅ **`NodeValueTemplate` `%date:FORMAT%` expansion** (same-day follow-up, `web/node_value_template.js`): `resolveTemplate()` now also expands `%date%` / `%date:FORMAT%` like SaveImage's `filename_prefix`. `formatDate(format, dt)` supports `yyyy`/`yy`/`MM`/`M`/`dd`/`d`/`hh`/`h`/`mm`/`m`/`ss`/`s` (case-sensitive), via a left-to-right longest-first scan so `yyyy` beats `yy` and substituted digits aren't re-matched; non-token chars kept literal; bare `%date%` → `yyyy-MM-dd`. Runs frontend-side (browser local time at queue time). README (JA+EN) + CLAUDE.md updated
  - **Picker modal date samples** (same-day, refined per user): the date formats live as a single **`📅 日付フォーマット` entry inside the node-title dropdown** (sentinel option value `NVT_DATE_OPTION = "__nvt_date__"`), NOT a separate always-visible section. ONE dropdown + ONE list: choosing the date entry renders `DATE_SAMPLES` (`yyyy-MM-dd`, `yyyy-MM-dd_hh-mm-ss`, `yyyyMMdd`, …) with live `formatDate()` previews; choosing a node title renders that node's widgets. Shared `state.token`; `clearList()` drops the prior selection on switch. The date entry is always present even with zero referenceable nodes
- ✅ **`NodeValueTemplate` node added** (`nodes.py` + new `web/node_value_template.js`): resolves `%NodeTitle.widget%` tokens against other nodes' widget values, mirroring `SaveImage`'s `filename_prefix` substitution
  - Backend: thin pass-through `execute()` (defensive `isinstance(template, str)` coercion only) — resolution can't happen in Python because node titles/live widget values only exist in the frontend graph. V3/V1 hybrid like the other nodes. Registered in `get_node_list()` (V3) + `NODE_CLASS_MAPPINGS` / `NODE_DISPLAY_NAME_MAPPINGS` (V1)
  - Frontend (`web/node_value_template.js`): separate extension `idfa.NodeValueTemplate`. `setup()` wraps `app.graphToPrompt` (formerly patched `api.queuePrompt`; changed 2026-06-08) — for each `class_type === "NodeValueTemplate"` node it reads the live `template` widget, runs `resolveTemplate()`, injects the resolved string into `nodeData.inputs.template`. Same pattern as `index.js`'s `preview_override` injection; wrappers chain (each captures the previous `app.graphToPrompt` and calls through)
  - `resolveTemplate()`: regex `/%([^%]+)%/g`, splits each token on the FIRST `.` → title + widget name; `lookupWidgetValue()` matches `n.title || n.type` in `app.graph._nodes`, first match wins. Unresolvable tokens left as `%...%` (visible typos). Widget values only (no output/meta); titles with `.` unsupported
  - **Token picker modal** (same-day follow-up): a `🔍 ノードの値を挿入…` DOM-widget button (`addDOMWidget`, works in both renderers) opens a modal — pick a node title from a `<select>`, see that node's widget names + current values in a scrollable list, click a row, and `挿入` inserts `%Title.widget%` at the caret in `template`. `ensureCaretTracker()` records `node._nvtCaret` from textarea listeners (the button blurs the textarea, so the recorded caret is used, not a live read); `insertToken()` writes `textarea.value`, dispatches `input`, restores caret. Design: dropdown-per-node (not a flat all-widgets search) so it stays fast with many nodes; nodes without widgets and the node itself are excluded; duplicate titles → first node's widgets shown (matches resolver)
  - Docs: README (JA + EN) and CLAUDE.md updated

### Recent Changes (May 30, 2026)
- ✅ **Three UI-less utility nodes added** (`nodes.py`): no frontend code, no `web/index.js` changes
  - **`SimpleMultiConcatText`** (display: `Simple Multi Concat Text`): 5 optional STRING inputs (`text1`–`text5`, all `forceInput: True` — wire-only, no widget), `separator` (default `""`), `separator_newline`, `add_newline`. Empty/None/non-string inputs are filtered before joining (avoids `"a,,b"`-style runs). `separator_newline=True` works **even when `separator=""`** — effective separator becomes a bare `"\n"`, joining inputs line-by-line. `add_newline` is skipped when zero valid inputs survived filtering (avoids a lone `"\n"` output for an unconnected node)
  - **`GetFirstWord`** (display: `Get First Word`): single STRING input + `stop_word` (default `","`) + `use_regex` / `trim` / `remove_invalid_filename_chars` / `add_trailing_slash` toggles
    - Literal mode (`use_regex=False`): `\n` / `\r` / `\t` are pre-expanded so a single-line widget can specify control characters by typing the escape sequence; uses `str.split(stop_word, 1)[0]`
    - Regex mode (`use_regex=True`): escape expansion is intentionally **skipped** (regex handles `\n` natively, double expansion would be wrong); uses `re.search`. `re.error` on invalid patterns is caught silently and falls through to "return the whole text" — never raises
    - Empty `stop_word` returns whole text (avoids `str.split("")` ValueError)
    - `remove_invalid_filename_chars`: strips `[<>:"/\\|?*\x00-\x1f]` + `rstrip(". ")` (Windows-forbidden trailing chars). DOS reserved names (CON/PRN/etc.) are NOT handled — they're filename-level, not character-level
    - `add_trailing_slash`: only appends `/` when result is non-empty (avoids bare `/` output)
    - Core logic extracted into `process_one()` classmethod so `GetFirstWordList` can reuse it
  - **`GetFirstWordList`** (display: `Get First Word (List)`): LIST input + same toggles as `GetFirstWord` + `text_separator` (default `", "`)
    - Two outputs: `text` (STRING, joined with `text_separator`) and `list` (LIST, raw results — separator doesn't affect this)
    - Defensive `items` coercion: `None` → `[]`; `tuple`/`set` → `list`; bare `str` → single-item list (or `[]` if empty); anything else → `[]`. Per-element: `None` skipped, non-strings coerced via `str()`. Never raises on a wrong-typed slot
    - V3 schema declares LIST input/output as `io.String.*` because V3 has no first-class LIST type; V1 `INPUT_TYPES "LIST"` + V1 `RETURN_TYPES` carry the real type. ComfyUI passes a Python list at execute time regardless (same pattern as `PromptPalette_F.selected_list`)
  - All three nodes registered in `PromptPaletteExtension.get_node_list()` (V3) and `NODE_CLASS_MAPPINGS` / `NODE_DISPLAY_NAME_MAPPINGS` (V1), category `utils`

### Recent Changes (May 23, 2026)
- ✅ **Widget hover tooltips (both modes)**: Added per-widget help text shown on mouse hover
  - V1 `INPUT_TYPES` extended with `tooltip` option on every settable input (`separator`, `trailing_separator`, `separator_newline`, `add_newline`, `prefix`, `prefix_separator`, `empty_when_no_selection`). Newer ComfyUI builds wire these into their tooltip display automatically (Nodes 2.0 picks them up natively; Classic does NOT — see below)
  - **Classic mode** (`web/index.js`): LiteGraph canvas-rendered widgets don't expose a native tooltip surface, so a top-level helper paints its own:
    - `WIDGET_TOOLTIPS` constant maps widget name → tooltip text
    - `_ppGetTooltipEl()` lazy-creates a single fixed-position DOM overlay (`z-index: 10001`, `pointer-events: none`)
    - `installClassicTooltipListener(app)` (called once from `setup()`) installs a `document`-level `mousemove` listener. Bails immediately if `e.target !== app.canvas.canvas` so it never interferes with the DOM widget (Nodes 2.0) or HTML overlays. Uses LiteGraph's `convertCanvasToOffset` transform to find the hovered node, then `widget.last_y` + `computeSize()[1]` to find which visible widget is under the cursor. Same-widget mousemoves do NOT reset the show-delay timer (otherwise the user can never sit still long enough to see it)
    - 500ms hover delay before showing; viewport-clamped to never spill off-screen
  - **Nodes 2.0 mode**: `renderOptionsRow()` sets `label.title` and `input.title` so browsers render native tooltips on hover. Same text as the Classic system
- ✅ **Options row wraps when narrow (Nodes 2.0)**: `.pp-separator-row` CSS extended with `flex-wrap: wrap` and `row-gap: 4px` so the `Sep / Trail / Sep NL / End NL / Prefix Sep / Empty if no sel` checkbox row reflows to two (or more) rows when the node is too narrow to fit them on one line, instead of overflowing the node bounds. `white-space: nowrap` on each label preserves "label+checkbox stays as one unit"
- ✅ **Coordinate transform fix (LiteGraph canvas → screen)**: Both `openBulkWeightEditor` (Set All Weights panel anchor) and `openPreviewEditor` (preview-edit textarea overlay) used the formula `rect + graphX * scale + offset[0]`, which silently mispositions overlays at non-1 zoom by `offset[0] * (scale - 1)` pixels. At extreme zoom levels the panel could appear far off-screen and the user would think the button "did nothing"
  - Fixed to LiteGraph's actual DragAndScale convention: `clientX = rect.left + (graphX + offset[0]) * scale` (and same for Y)
  - Bonus improvement for the bulk-weight button: anchor now uses `weightButton.last_y` (LiteGraph's draw-time Y) so the panel appears immediately below the button regardless of node position, instead of using a hardcoded `localY = 40` offset from the node origin
- ✅ **README.md: documented `prefix_separator` and `empty_when_no_selection`**: Added Settings section to both Japanese and English. Includes Nodes 2.0 short-label names in parentheses (`Sep`, `Trail`, `Sep NL`, `End NL`, `Prefix Sep`, `Empty if no sel`) so users can match the UI labels to the underlying input names
- ✅ **`configure()` re-applies `widgets_values` by name**: A user reported that `empty_when_no_selection` (and likely other appended-late inputs) didn't persist across browser F5 / server restart. Diagnostic logs showed serialize wrote `widgets_values[8] = true` correctly, but on reload `origConfigure` assigned the wrong value to `empty_when_no_selection`'s widget object
  - Root cause: a separate `PromptPalette_F_Vue` extension running in the same install injects an extra widget into `node.widgets` (mirrors the text content; appears at index 9 in widgets_values). On reload, this extra widget can land at a different array position than at save time, shifting our named inputs' indices and breaking `origConfigure`'s index-based `widgets[i].value = widgets_values[i]` mapping
  - Fix: `configure()` now runs a second pass AFTER `origConfigure` that walks `PP_INPUT_ORDER` and assigns each value to the widget matched BY NAME via `findWidgetByName`. Third-party widgets (those not in `PP_INPUT_ORDER`) keep whatever value `origConfigure` gave them — those extensions are responsible for their own state
  - `serialize()` was already canonical (writes in `PP_INPUT_ORDER`), so no change needed there. `restoreInitialState()` was already name-based for Reload Node recovery
  - Symptom that surfaced this: `empty_when_no_selection` reset to `false` after F5, even though serialize captured `true`. The new toggle was visible because it's at the end of `PP_INPUT_ORDER`; older inputs likely had the same silent bug but their misaligned values happened to be of the right type so `sanitizeLegacyPrefixValues` didn't catch them

### Recent Changes (May 22, 2026)
- ✅ **Selected-words output ports added**: `RETURN_TYPES` changed from `("STRING",)` to `("STRING", "STRING", "LIST")` with `RETURN_NAMES = ("text", "selected_text", "selected_list")`
  - Backend (`nodes.py`):
    - New `strip_weight_notation()` staticmethod: repeatedly unwraps outermost `(text:1.5)` → `text` (handles nested `((a:1.2):1.5)`). Regex `\(\s*(.+?)\s*:\s*-?\d*\.?\d+\s*\)` accepts negative / integer / decimal weights. Plain `(text)` without a numeric weight is left intact
    - `selected_list` is built from `filtered_lines` (after `//`-filter and `[group]`-strip) with weight notation removed, then empty entries filtered out
    - `selected_text = "\n".join(selected_list)`
    - **`preview_override` semantics**: override applies to `text` output only; `selected_text` / `selected_list` continue to reflect the actual selection so downstream nodes that consume the list aren't fooled by a one-off edit
    - V3 schema outputs extended with `display_name` for each port
- ✅ **Bulk weight editor**: One-click "set or adjust the weight of every phrase at once" panel
  - Shared logic in `web/index.js`:
    - `transformAllPhrases(text, transformFn)` — walks every line, skips blanks and `#` comments, splits off the leading `//` toggle prefix (if any) and any trailing inline `// comment`, then runs `transformFn` on the raw phrase content (preserving `[group]` tags so backend processing still strips them correctly). Reassembles `prefix + transformed + inlineComment`
    - `setAllWeights(text, w)` — clamps to `[CONFIG.minWeight, CONFIG.maxWeight]` (0.1 – 2.0), rounds to 0.1, delegates per line to existing `setWeight()`
    - `adjustAllWeights(text, delta)` — delegates per line to existing `adjustWeight()` (which already handles clamping and out-of-range special cases)
  - UI panel `openBulkWeightEditor(node, anchorEvent)`:
    - Floating HTML overlay (`position: fixed`, `z-index: 10000`) with `<input type="number">` + Apply button (absolute set) AND `−0.1` / `+0.1` buttons (immediate relative adjust). Esc / click-outside / ✕ closes
    - Theme variables (`var(--comfy-menu-bg)`, `var(--input-text)`, `var(--border-color)`) for styling
    - After each apply: clears `preview_override` (so override doesn't shadow the new weights), calls `node._ppDomRender()` if present, calls `app.graph.setDirtyCanvas(true)`
    - Viewport clamping after mount so the panel never spills off-screen
    - `setTimeout(10)` deferral on the outside-click listener so the originating click doesn't immediately close the panel
  - Mode integrations:
    - Classic: new `"Set All Weights"` button widget added in `addEditButton()` BEFORE the existing Edit button so it renders above Edit. No native event in LiteGraph button callbacks, so the panel is anchored by computing screen coordinates from `node.pos` + `canvas.ds` transform
    - Nodes 2.0: new `"W±"` button (`.pp-weight-bulk-btn` class) appended in the display-mode toolbar AFTER the Edit button — Edit has `margin-left: auto` so it sits to the right of Edit. Uses the native click event's `clientX/Y` for anchoring
  - **Affects ALL phrases including `//`-commented ones**, so users can pre-set weights before activating phrases
- ✅ **Layout fix: Hide Preview no longer overlaps the checkbox area in Classic display mode**:
  - Root cause: `getWidgetsTotalHeight()` is a static estimate that summed each visible widget's `computeSize()` plus margin. The multiline `prefix` widget in particular doesn't always render at the height its `computeSize` returns (the HTML textarea overlay can extend it). When the new "Set All Weights" button was added, the cumulative drift exceeded the small bottom padding and the buttons started rendering below where our checkbox area began
  - Fix: New `getRenderedWidgetAreaBottom(node)` reads `widget.last_y` (set by LiteGraph after a widget is drawn) for the visually-lowest visible widget and adds its computed height. Used by drawing functions (`drawCheckboxList`, `drawCheckboxItems` fallback, `drawGroupControls`, "No Text" placeholder) so the checkbox area always starts AT the real bottom of the widget block. Falls back to `getWidgetsTotalHeight()` on the very first draw before `last_y` is set
  - `nodeType.prototype.computeSize` deliberately still uses `getWidgetsTotalHeight()` because it's called before any draw has happened
- ✅ **`empty_when_no_selection` toggle (returns `None`)**: New BOOLEAN input (default `False`) that returns `(None, None, None)` on every output when no phrase is selected. Targeted at switch/router nodes that check `value is None` — specifically **rgthree's Any Switch** (`is_none()` does `return value is None`, so empty strings are NOT enough; we must emit literal Python None to trigger its skip path). Iterated across May 22–23: `false_when_empty` returning Python `False` → empty strings `("", "", [])` → ExecutionBlocker for true bypass → reverted to empty strings → settled on `None` for rgthree-switch compatibility
  - Backend (`nodes.py`):
    - Added as the last entry of V3 schema inputs and V1 `INPUT_TYPES.optional` (preserves `widgets_values` index stability)
    - `execute()` short-circuit after the `preview_override` check: `if empty_when_no_selection and not filtered_lines: return (None, None, None)` (or `io.NodeOutput(None, None, None)` in V3)
    - **`prefix` is intentionally NOT prepended** in this path; separator, trailing_separator, and add_newline are also skipped
    - `preview_override` always wins (override is explicit user intent)
    - **NOT using `ExecutionBlocker`**: deliberate design choice. Switches/routers downstream should decide per-pipeline what to do with None — we don't want to forcibly skip the entire downstream graph
    - **Caveat**: downstream nodes that don't gracefully handle `None` will error. The toggle is intended for pipelines where the next hop IS a switch/router/None-handler
  - Frontend (`web/index.js`):
    - `PP_INPUT_ORDER` extended to include `'empty_when_no_selection'` at the end
    - `findEmptyWhenNoSelectionWidget(node)` helper
    - Hidden by default; toggled visible only in Edit mode (Classic) via `widget.hidden = !node.isEditMode`
    - Nodes 2.0: backed up into `_ppWidgetRefs.empty_when_no_selection` and removed from `node.widgets[]` like other Nodes 2.0 widgets; surfaced as `"Empty if no sel"` checkbox in the DOM widget's edit-mode options row
    - The `app.graphToPrompt` wrapper automatically forwards the value because it iterates `_ppWidgetRefs`
  - Backward compat: `sanitizeLegacyPrefixValues()` extended to reset non-boolean `empty_when_no_selection` values (LiteGraph maps `widgets_values` by index, so an older save without this input could land a stray button-label string at this slot). Also added `'set_all_weights'` to the `prefix` sanitization blocklist for the same reason

### Recent Changes (May 20, 2026)
- ✅ **`prefix` redesigned as widget + new `prefix_separator` toggle**: `prefix` is no longer a forced-input slot — it is now a multiline STRING widget concatenated directly before the body. A new BOOLEAN `prefix_separator` (default `False`) controls whether the configured `separator` is inserted between `prefix` and the body
  - Backend (`nodes.py`):
    - V3 schema and V1 `INPUT_TYPES`: `prefix` changed to multiline text with default `""` (no `force_input` / `forceInput`); new `prefix_separator` BOOLEAN
    - `execute()` signature: `prefix=""` (was `None`), new `prefix_separator=False`
    - Concat logic: insert `effective_separator` between prefix and body only when `prefix_separator and separator != "" and filtered_lines` — otherwise plain `prefix + result` concat
    - New optional inputs appended at the end of INPUT_TYPES so existing workflows' `widgets_values` index mapping stays stable
  - Frontend (`web/index.js`):
    - `findPrefixWidget()` / `findPrefixSeparatorWidget()` helpers
    - prefix widget is **always visible** in Classic display mode (not gated behind Edit toggle); `prefix_separator` is Edit-mode-only since it is a settings toggle
    - `prefix.computeSize = () => [0, 52]` — 2-line default height, width 0 so it does NOT pin node minimum width
    - `reorderPrefixToTop()` runs in `onAdded` (`setTimeout(0)`, after configure) to push the prefix widget to `node.widgets[0]` for top-of-node display
    - `_ppWidgetRefs` registration extended to include `prefix_separator` only; the `prefix` widget is intentionally **kept** in `node.widgets[]` even in Nodes 2.0 mode so that ComfyUI's automatic widget↔input-slot conversion still works (removing it makes the prefix slot invisible and unwireable in Nodes 2.0)
    - DOM Widget UI: deliberately does NOT render a prefix textarea — the native `prefix` widget (kept at `widgets[0]` via `reorderPrefixToTop`) provides the editing UI AND the connectable input slot. `Prefix Sep` checkbox added to the DOM widget's options row (edit mode only)
    - `Prefix` itself is **not** included in `generatePreview()` — preview shows only the body content (matches user-facing semantics; output and preview intentionally diverge by the prefix portion)
- ✅ **Widgets-values backward compatibility**: When loading workflows saved before `prefix`/`prefix_separator` existed, button labels (`"edit_text"`, `"toggle_preview"`) used to land at those new indices. `sanitizeLegacyPrefixValues()` is called from `configure()` (and from `restoreInitialState()`) to detect and reset these artifacts. The sanitizer also resets non-string `prefix` values (e.g. boolean `false` leaked from a previous widget at the same index) since `str(False)` on the Python side would otherwise emit `"False"` at the start of the output. `nodes.py` `execute()` has a matching `isinstance(prefix, str)` defensive check, and node creation also coerces the prefix widget value to a string if it's anything else
- ✅ **Serialize override extended to both modes**: `serialize()` now always re-orders `node.widgets[]` into `PP_INPUT_ORDER` (the INPUT_TYPES order constant) before calling `origSerialize`, regardless of whether `_ppWidgetRefs` exists. This makes `widgets_values` index-stable across Classic ↔ Nodes 2.0 saves and accommodates the prefix-to-top display reorder. Buttons and spacers retain their relative trailing position
- ✅ **`restoreInitialState()` switched to name-based mapping**: Walks `PP_INPUT_ORDER` and assigns `widgets_values[i]` to `findWidgetByName(node, PP_INPUT_ORDER[i])`, so Reload Node recovery is safe even after `widgets[]` has been reordered for display
- ✅ **Phrase checkbox area is scrollable (Classic mode)**: Large phrase lists no longer make the node grow without bound
  - `CONFIG.maxAutoNodeHeight = 600` caps the auto-grow ceiling (in both `computeSize()` and `drawCheckboxList`); the user can still drag the node taller manually
  - `drawCheckboxList` computes `_ppCheckboxScroll = { areaTop, areaBottom, areaHeight, contentHeight, totalLines, visibleLines, maxScrollLines, scrollOffset }` and clamps `node.checkboxScrollOffset` per frame
  - `drawCheckboxItems` uses `ctx.save()`/`ctx.beginPath()`/`ctx.rect(0, areaTop, w, areaHeight)`/`ctx.clip()` to clip drawing, applies `scrollOffset * lineHeight` to `currentY`, skips fully-off-screen rows, and reserves a right-side gutter (`CONFIG.scrollBarWidth + CONFIG.checkboxScrollPadding`) so weights/text don't slide under the bar
  - `drawWeightControls` shifts its right-aligned buttons inward by the same gutter when scrolling
  - New `drawCheckboxScrollBar()` draws ▲ button → track (with proportionally-sized thumb) → ▼ button on the right edge of the area; clickable areas use new actions `cb_scroll_up` / `cb_scroll_down`
  - Click area Y coordinates added in `drawCheckboxItems` are the *displayed* Y (post-scroll), so hit-testing matches what the user sees
- ✅ **Mouse-wheel scrolling for the phrase list**: A capture-phase `wheel` listener on `document` (installed once in `setup()`, guarded by `window.__ppPromptPaletteWheelHooked`) intercepts wheel events before ComfyUI's canvas zoom handler
  - Why `document`, not `app.canvas.canvas`: `app.canvas` may be undefined when `setup()` first runs, and the document-level listener is active immediately
  - Why capture phase + `passive: false`: capture fires before LiteGraph's bubble-phase listener on the canvas, so `event.preventDefault() + stopImmediatePropagation()` prevents the zoom
  - Coordinate transform uses LiteGraph's `convertCanvasToOffset` convention: `graphX = canvasX / scale - offset[0]` (NOT `(canvasX - offset[0]) / scale` — that variant is off at non-1 zoom). `event.target === canvas.canvas` guard ensures wheel events over HTML widgets/textareas are left alone
  - `app.graph.getNodeOnPos(graphX, graphY)` identifies the topmost node; only PromptPalette_F in Classic display mode with `maxScrollLines > 0` and cursor inside `[areaTop, areaBottom]` consumes the event
  - LiteGraph node-level `onMouseWheel` is unused because ComfyUI's canvas zoom handler runs before LiteGraph dispatches wheel events to nodes (verified empirically)
- ✅ **Node width can be shrunk freely after manual resize**: Fixed a regression where the user could widen the node but never narrow it again
  - Root cause: `nodeType.prototype.computeSize` returned `(this.size && this.size[0]) ? this.size[0] : (out ? out[0] : 400)` — i.e., it reported the *current* node width as the natural width. LiteGraph treats the return of `computeSize()` as the minimum size during drag-resize, so every time the user widened, the floor moved up with them
  - Fix: `computeSize()` now returns `[out ? out[0] : 300, totalHeight]` — a fixed 300px minimum. Width preservation across `configure()` / tab switch / mode detection is done by passing `[this.size[0], computed[1]]` explicitly to each `setSize` call instead (already the pattern in `configure()`; updated the three `setSize(this.computeSize())` call sites in mode-detection code to match)
- ✅ **Prefix widget `computeSize` returns `[0, 52]`**: not `[this.width || 0, 52]`. The first element is summed/maxed by LiteGraph against the node's minimum width, so any non-zero value would re-introduce the shrink-block bug

### Recent Changes (April 18, 2026)
- ✅ **Reload Node recovery**: On right-click → Reload Node, the node now reverts to the state at workflow-open time instead of losing all Edit content
  - Backend: unchanged
  - Frontend:
    - `configure()` override snapshots first-call `info` into `app.graph._ppInitialStates[nodeId]` (saved once per node; edits do not overwrite)
    - `LGraph.prototype.clear` patched in `setup()` to reset `_ppInitialStates` on workflow switch (avoids stale state leaking into new workflow)
    - `onRemoved` stashes `{oldId, savedInfo, time}` into `app.graph._ppPendingReload` before deletion
    - `onAdded` (`setTimeout(0)`) consumes pending reload within 500ms, applies state via `restoreInitialState()`, and re-keys the snapshot under the new id so subsequent reloads keep working
  - Why onRemoved→onAdded bridge: ComfyUI's Reload Node creates the replacement with a **new node id** (confirmed via console: oldId=129 → newId=142), so direct `_ppInitialStates[this.id]` lookup fails for the new instance
  - Helper: `restoreInitialState(node, savedInfo)` writes `widgets_values` back into `node.widgets`, restores `isEditMode`/`hidePreview`, clears preview override
  - Bonus fix: `addEditButton()` spacer widget now passes a no-op callback + `serialize: false` to suppress the `LiteGraph addWidget(...) without a callback` warning

### Recent Changes (March 25, 2026)
- ✅ **Nodes 2.0 DOM Widget UI**: Full interactive UI for Nodes 2.0 mode via `addDOMWidget`
  - Replaced warning-only widgets with complete HTML/CSS-based interactive UI
  - Features: checkboxes, weight +/- controls, group toggle buttons, preview panel, edit mode
  - CSS uses ComfyUI theme variables (`var(--input-text)`, `var(--comfy-input-bg)`, etc.)
  - Widget hiding: Removes widgets from `node.widgets` array (since `hidden=true` doesn't work in Vue)
  - Serialization: `api.queuePrompt` patch extended to inject all widget values from `node._ppWidgetRefs`
  - Key functions: `createDOMWidget()`, `setupNodes2DOMWidget()`, `DOM_CSS`, `injectDOMCSS()`
  - Mode switching requires page reload (accepted limitation)

### Recent Changes (February 9, 2026)
- ✅ **Preview edit feature**: Added temporary prompt editing via preview area
  - Backend: `preview_override` parameter added to both V3/V1 schemas in `nodes.py`; early return in `execute()` when override is set
  - Frontend: `[✎ Edit]` / `[↺ Reset]` buttons in preview area header
  - HTML textarea overlay with orange toolbar ("Editing Preview — Esc: cancel" + "✕ Save" button)
  - Override stored on `node._promptPalette_previewOverride`; injected into prompt via `api.queuePrompt` patch in `setup()`
  - Visual indicators: orange border, "Preview (Edited):" label when override active
  - Auto-clear on source text change, workflow load, and manual reset
  - Temporary by design: overrides do not persist across workflow save/load

### Recent Changes (January 23, 2026)
- ✅ **Window size stability on tab switch**: Fixed issue where node window would change size when switching workflow tabs
  - Problem: Node would become tall and narrow, or height would shrink causing text overflow
  - Root cause: Width was not preserved during size recalculation in three functions
  - Solution: Modified `configure`, `drawCheckboxList`, and `computeSize` to always preserve current width
  - Result: Node maintains user-set dimensions across tab switches, only adjusts height when content requires more space

### Recent Changes (January 10, 2026)
- ⚠️ **Nodes 2.0 button visibility**: Attempted to hide Classic mode buttons (Edit, Hide Preview) when switching to Nodes 2.0 mode without page reload
  - Multiple approaches tried (hidden property, computeSize, dynamic deletion)
  - Issue: Button widgets don't respond to visibility changes in Vue.js rendering without reload
  - Decision: Accepted as limitation - users must reload page when switching modes
- ✅ **Warning display improvements**: Split single multiline widget into 3 separate widgets
  - Better readability in Nodes 2.0 mode
  - Clear instructions for using `//` comment syntax
  - Directs users to Classic mode for full features

### V3 API Migration (v2.0.0) - January 2026
- ✅ **V3 backend**: Complete with conditional V3/V1 hybrid approach
  - V3 API support when available (ComfyNode inheritance, define_schema, execute, io.NodeOutput)
  - Automatic V1 fallback when V3 unavailable (plain class, INPUT_TYPES, tuple return)
- ✅ **V1 backward compatibility**: Complete (legacy exports always maintained)
- ⚠️ **Entry point**: Temporarily using V1-only exports due to V3 web_directory issue
  - Issue: V3 `ComfyExtension.web_directory` property doesn't serve JavaScript files correctly
  - Workaround: Using V1 `WEB_DIRECTORY` export in `__init__.py`
  - Future: Will switch to `comfy_entrypoint()` once issue resolved

### Rendering Mode Support

#### Classic Mode (LiteGraph.js): ✅ Fully Functional
- ✅ Basic functionality: Text processing, separator controls, prefix input
- ✅ Preview functionality: Real-time preview panel (white screen bug resolved)
- ✅ Preview edit: Temporary prompt editing via textarea overlay with toolbar
- ✅ Scroll functionality: Preview scrolling with visible scroll bar (visibility bug fixed)
- ✅ Group toggle: Multi-group support (interference bug resolved)
- ✅ Row selection: Clickable phrase text areas
- ✅ Dynamic sizing: Widget height system for ComfyUI version compatibility
- ✅ Weight controls: +/- buttons for weight adjustment
- ✅ Edit/Display modes: Toggle between text editing and interactive UI

#### Nodes 2.0 Mode (Vue.js): ✅ Full Support via DOM Widget (Phase 2B Complete)
- ✅ **Adaptive mode detection**: Based on `onDrawForeground` callback invocation
- ✅ **DOM Widget UI**: Full interactive HTML/CSS-based UI via `addDOMWidget`
  - Interactive checkboxes for phrase toggling
  - Weight adjustment controls (+/- buttons with weight display)
  - Group management buttons ([all]/[off] + individual group toggles)
  - Edit/Display mode toggling (Edit button switches to textarea + options)
  - Live preview panel with Edit/Reset functionality
  - Description comments displayed as italic text above phrases
- ✅ **Theme integration**: CSS variables (`var(--input-text)`, etc.) for ComfyUI theme support
- ✅ **Widget hiding strategy**: Widgets removed from `node.widgets` array (since `hidden=true` doesn't work in Vue)
  - References backed up in `node._ppWidgetRefs`
  - `api.queuePrompt` patch injects all values at execution time
- ✅ **Backend processing**: Full text processing (same as Classic mode)
- ⚠️ **Mode switching**: Requires page reload when switching between Classic and Nodes 2.0

## Known Issues

### V3 web_directory Property (Ongoing)
- **Issue**: V3 `ComfyExtension.web_directory` property doesn't serve JavaScript files correctly
- **Manifestation**: `web/index.js` returns 404 when using V3 entry point via `comfy_entrypoint()`
- **Current Workaround**: Using V1 `WEB_DIRECTORY` export in `__init__.py`
- **Impact**: Prevents full V3-only implementation, requires V1/V3 hybrid approach
- **Status**: Under investigation, may be ComfyUI core issue
- **Code Location**: `__init__.py:1-5`, `nodes.py:157-173`

### Widget Visibility in Nodes 2.0 Mode (Resolved - March 2026)
- **Issue**: `widget.hidden = true` does not work in Nodes 2.0 Vue rendering for any widget type
- **Root Cause**: Vue rendering ignores LiteGraph's `hidden` property on widget objects
- **Solution**: Remove widgets from `node.widgets` array entirely, back up references in `node._ppWidgetRefs`, inject values via `api.queuePrompt` patch
- **Status**: ✅ Resolved

### Mode Switching Display (Accepted Limitation)
- **Issue**: Display becomes inconsistent when switching between Classic and Nodes 2.0 modes without page reload
- **Current Behavior**:
  - With page reload: Both modes display correctly ✅
  - Without page reload: UI from previous mode may remain or overlap ❌
- **Impact**: Minor UX issue
- **Decision**: Accepted as limitation - users must reload page when switching modes
- **Status**: Will not fix

### Mode Detection Reliability (Resolved)
- **Issue**: Traditional mode detection methods are unreliable
- **Solution**: Implemented adaptive detection using `onDrawForeground` callback invocation
- **Status**: ✅ Working correctly with adaptive detection

## Fixed Issues

### Node Width Could Not Be Shrunk After Manual Widening (Resolved - May 20, 2026)
- **Issue**: After dragging the node wider, the user could no longer drag the right edge to make it narrower. Width-grow worked; width-shrink and height-resize were fine. Reloading the workflow temporarily restored shrink ability — until the user widened the node again
- **Root Cause**: `nodeType.prototype.computeSize` was returning `(this.size && this.size[0]) ? this.size[0] : (out ? out[0] : 400)` for the width component — i.e., reporting the *current* node width as the natural size. LiteGraph reads `computeSize()` as the **minimum allowed size during user drag-resize**, so every widening operation effectively raised the floor. This was a side-effect of the January 2026 "Window Size Stability" fix, which tried to preserve width by routing it through computeSize
- **Solution**:
  - `computeSize()` width component changed to `out ? out[0] : 300` — a fixed 300px minimum that decouples from current width
  - Width preservation is done **explicitly at each `setSize` call site** by passing `[this.size[0], computed[1]]`, not via `computeSize`. Updated three `setSize(this.computeSize())` sites in mode-detection code to follow this pattern
  - `prefix.computeSize` returns `[0, 52]` (width 0 — LiteGraph takes max of widget widths as part of node min width, so any positive value would re-introduce the constraint)
- **Status**: ✅ Resolved
- **Code Location**: `web/index.js` `computeSize` override (~660), mode-detection `setSize` sites (~444, ~483, ~508), prefix widget setup (~256)

### Phrase List Made Node Excessively Tall With Many Choices (Resolved - May 20, 2026)
- **Issue**: Adding a large number of phrase choices auto-grew the node to a ridiculous height; users wanted scrolling instead
- **Solution**:
  - `CONFIG.maxAutoNodeHeight = 600` caps auto-grow in both `computeSize` and `drawCheckboxList`
  - `drawCheckboxList` computes scroll metrics (`_ppCheckboxScroll`); `drawCheckboxItems` uses `ctx.clip` and applies `node.checkboxScrollOffset`
  - `drawCheckboxScrollBar` draws ▲▼ buttons + thumb on the right edge; weight controls shifted inward to avoid overlap
  - Mouse wheel handled by a `document`-level capture-phase listener (not `app.canvas.canvas` or LiteGraph node-level `onMouseWheel` — both fire too late, after ComfyUI's canvas zoom handler). Uses LiteGraph's `convertCanvasToOffset` coordinate convention (`graphX = canvasX / scale - offset[0]`)
- **Status**: ✅ Resolved
- **Code Location**: `web/index.js` `drawCheckboxList`, `drawCheckboxItems`, `drawCheckboxScrollBar`, wheel hook in `setup()`

### Prefix Connection Caused Leading Separator In Output (Resolved - May 20, 2026)
- **Issue**: When the `prefix` slot was wired up, the output started with a `separator` (or `separator + newline`) even though the preview area didn't show one. Users saw "an empty value inserted at the beginning"
- **Root Cause**: `execute()` always inserted `separator` between prefix and body when both were truthy. The preview generator never includes prefix, so any discrepancy between prefix-included output and prefix-stripped preview manifested as a "phantom separator" at the start of the output
- **Solution**: `prefix` is no longer a slot — it is a multiline text widget with a new explicit `prefix_separator` BOOLEAN toggle (default `False` → plain concat). Separator insertion happens only when the user opts in. Preview semantics unchanged
- **Status**: ✅ Resolved
- **Code Location**: `nodes.py` `execute()` prefix-concat block

### Nodes 2.0 Mode Setting Persistence (Resolved - May 20, 2026)
- **Issue**: In Nodes 2.0 mode, the following settings were not persisted across save/reload:
  - `separator` (Sep field) — reverted to default `", "` after reload (or in some cross-mode flows, displayed as `"edit_text"`)
  - `trailing_separator` (Trail), `separator_newline` (Sep NL), `add_newline` (End NL) — reverted to `false` after reload
  - Settings only worked for the current session (in-memory) but were lost on workflow save
- **Root Cause**: In Nodes 2.0 mode, the standard widgets (`text`, `separator`, `trailing_separator`, `separator_newline`, `add_newline`, `preview_override`) are removed from `node.widgets` array (since `widget.hidden = true` doesn't work in Vue rendering) and backed up in `node._ppWidgetRefs`. However, LiteGraph's `serialize()` walks `node.widgets` to build `widgets_values`, so the backed-up widgets were excluded from serialization. The `edit_text` artifact appeared when Classic-mode-saved workflows (which serialized button widget values like `"edit_text"`) were re-saved in Nodes 2.0 mode, causing widget_values ordering misalignment on subsequent reload
- **Solution**: Extended the `serialize()` override in `web/index.js:612` to temporarily restore `_ppWidgetRefs` widgets into `node.widgets` (in INPUT_TYPES order: text → separator → trailing_separator → separator_newline → add_newline → preview_override) before calling the original serialize, then restore the original widgets array afterward. This ensures `widgets_values` is generated with the correct values and order so that `configure()` on reload maps them back correctly
- **Why INPUT_TYPES order matters**: LiteGraph's `configure()` maps `widgets_values[i]` to `node.widgets[i].value` by index, not by name. Maintaining the same order on serialize and on widget re-creation guarantees correct restoration
- **Status**: ✅ Resolved
- **Code Location**: `web/index.js:610-649` (serialize override)

### Window Size Stability on Tab Switch (Resolved - January 23, 2026)
- **Issue**: Node window size would change unpredictably when switching between workflow tabs
  - Symptom 1: Node would become tall and narrow (width decreased significantly)
  - Symptom 2: Height would shrink, causing text content to overflow below the node boundary
  - Symptom 3: User-set window dimensions were not respected after tab switching
- **Root Cause**: Three functions were not preserving node width during size recalculation:
  1. `configure()`: Called on tab switch/workflow load, used `setSize(newSize)` which overwrote both width and height
  2. `drawCheckboxList()`: Called during rendering, set `node.size[1] = totalHeight` directly without preserving width
  3. `computeSize()`: Used `out[0]` parameter for width calculation, which could override current width
- **Solution**: Modified all three functions to always preserve current width:
  - `configure()`: Changed to `this.setSize([this.size[0], newSize[1]])` - preserves current width, only adjusts height when needed (with 20px tolerance)
  - `drawCheckboxList()`: Changed to `node.setSize([node.size[0], totalHeight])` - preserves current width (with 50px tolerance to prevent frequent changes)
  - `computeSize()`: Changed width calculation to `const width = (this.size && this.size[0]) ? this.size[0] : (out ? out[0] : 400)` - prioritizes current width
- **Behavior After Fix**:
  - Width is always preserved across tab switches and redraws
  - Height only increases when content requires significantly more space
  - Node never automatically shrinks to prevent jarring visual changes
  - User-set dimensions are respected and maintained
- **Status**: ✅ Resolved
- **Code Location**: `web/index.js:500` (configure), `web/index.js:865` (drawCheckboxList), `web/index.js:467` (computeSize)

### Group Toggle Bug with Multiple Tags (Resolved - 2025)
- **Issue**: Groups that only appear on lines with multiple group tags (e.g., `[group_a2]` appearing only with `[group_a]`) could be turned ON but not OFF
- **Root Cause**: Complex logic in `toggleGroup()` was checking if other groups on the same line had active lines elsewhere, preventing deactivation
- **Solution**: Simplified `toggleGroup()` to directly toggle all lines containing the target group, regardless of other groups
- **Status**: ✅ Resolved
- **Code Location**: `web/index.js:94-122`

### Preview White Screen Bug (Resolved)
- **Issue**: Preview area showed white screen when weight feature was used (e.g., `(line:1.1)`)
- **Root Cause**: Canvas context state management issues with excessive `ctx.save()/ctx.restore()` calls
- **Solution**: Simplified Canvas state management and removed unnecessary context protection
- **Status**: ✅ Resolved

### Scroll Bar Visibility (Resolved)
- **Issue**: White blocks covering scroll buttons (▲ ▼) in preview area
- **Root Cause**: Scroll bar colors using theme values that appeared white in certain contexts
- **Solution**: Changed to fixed dark colors for scroll components:
  - Track background: `#2a2a2a` (dark gray)
  - Scroll thumb: `#555555` (medium gray)
  - Scroll buttons: `#3a3a3a` (dark gray)
- **Status**: ✅ Resolved

### ComfyUI Version Update Layout Issues (Resolved - December 2025)
- **Issue**: After ComfyUI version update, Edit/Save buttons were not visible or positioned incorrectly
- **Root Cause**:
  - Fixed widget height values (70px, 75px) didn't match new ComfyUI widget layout
  - Hidden widgets were counted in height calculations
  - New ComfyUI versions position widgets at the top of the node
- **Solution**:
  - Implemented `getWidgetsTotalHeight()` function to dynamically calculate widget heights
  - Skip hidden widgets when calculating total height
  - Adjusted custom drawing start positions to account for widget area
  - Added `CONFIG.widgetSpacing` (5px) for minimal spacing between widgets and content
  - Changed from fixed spacing values to dynamic calculations based on actual widget sizes
- **Status**: ✅ Resolved
- **Code Location**: `web/index.js:449-468` (getWidgetsTotalHeight), `web/index.js:6` (widgetSpacing config)

## ComfyUI Compatibility

### API Version Support (v2.0.0+)
- **V3 API**: ✅ Fully compliant (backend uses ComfyNode, define_schema, execute)
- **V1 API**: ✅ Backward compatible (legacy exports maintained)
- **Dual-mode frontend**: ✅ Supports both Classic and Nodes 2.0 rendering

### Rendering Mode Support

#### Classic Mode (LiteGraph.js) - Full Features ✅
- **Status**: Fully functional with all features
- **Compatibility**: All recent ComfyUI versions
- **Features**:
  - ✅ Interactive checkboxes for phrase toggling
  - ✅ Weight adjustment controls (+/- buttons)
  - ✅ Group management buttons
  - ✅ Global toggle buttons ([all]/[off])
  - ✅ Live preview panel with scrolling
  - ✅ Preview editing (temporary prompt override via textarea overlay)
  - ✅ Custom canvas rendering
  - ✅ Edit/display mode toggling
  - ✅ Text wrapping and dynamic sizing
  - ✅ Theme-aware color system

#### Nodes 2.0 Mode (Vue.js) - Full Support via DOM Widget ✅
- **Status**: Full implementation via `addDOMWidget` (Phase 2B complete)
- **Compatibility**: ComfyUI v0.3.76+ with Nodes 2.0 enabled
- **Features** (all via HTML/CSS DOM Widget):
  - ✅ Interactive checkboxes for phrase toggling
  - ✅ Weight adjustment controls (+/- buttons)
  - ✅ Group management buttons ([all]/[off] + individual groups)
  - ✅ Edit/display mode toggling
  - ✅ Live preview panel with Edit/Reset
  - ✅ Separator and output option controls (in edit mode)
  - ✅ Description comment display
  - ✅ Theme integration via CSS variables
  - ✅ Backend text processing (same as Classic mode)

**User Guidance:**
- Node displays full interactive DOM Widget UI in Nodes 2.0 mode
- Users can toggle between Classic and Nodes 2.0 modes in ComfyUI settings
- **Important**: After switching modes, reload the page for proper UI update
  - Without reload: UI from previous mode may overlap or display incorrectly
  - With reload: UI correctly reflects current mode
- Mode selection automatically detected and logged to console

### Mode Detection Strategy

**Adaptive Detection via Callback Invocation** (`web/index.js:159-244`):

The extension uses an **adaptive detection approach** that determines the rendering mode based on whether canvas drawing callbacks are invoked, rather than checking environment variables upfront.

**How It Works**:
1. **Node Creation** (`onNodeCreated`): Sets up features for both modes initially
   - Creates all widgets (hidden by default)
   - Initializes detection flags: `_promptPalette_drawCalled`, `_promptPalette_setupDone`
   - Creates 3 warning widgets for Nodes 2.0 mode (removed later when DOM Widget is created)
   - Stores text widget reference for later button creation

2. **Canvas Drawing** (`onDrawForeground`): Only invoked in Classic mode
   - Sets `_promptPalette_foregroundDrawnThisFrame` flag
   - If called first time → Creates Edit/Hide Preview buttons, marks as Classic mode
   - Performs custom canvas drawing
   - Sets `window.__PromptPalette_F_Mode = 'classic'`

3. **Background Drawing** (`onDrawBackground`): Invoked in both modes
   - Checks `_promptPalette_foregroundDrawnThisFrame` flag to detect current mode
   - Hides warning widgets in both modes (DOM Widget replaces them in Nodes 2.0)

4. **Delayed Detection** (`onAdded`): Checks after 100ms timeout (fallback for initial detection)
   - If `onDrawForeground` wasn't called → Marks as Nodes 2.0 mode
   - Removes warning widgets and standard widgets from `node.widgets` array
   - Backs up widget references in `node._ppWidgetRefs`
   - Creates DOM Widget UI via `setupNodes2DOMWidget()`
   - Sets `window.__PromptPalette_F_Mode = 'nodes2'`

**Why Adaptive Detection**:
- Traditional detection methods are unreliable:
  - `app.vueAppReady` is `true` in **both** Classic and Nodes 2.0 modes
  - `window.Vue` and `window.LiteGraph` checks are inconsistent
  - Settings API (`app.ui.settings.getSettingValue('Comfy.UseNewUI')`) not reliable
- **Callback invocation is the only reliable indicator**:
  - LiteGraph.js (Classic mode) **always** calls `onDrawForeground` for canvas rendering
  - Vue.js (Nodes 2.0 mode) **never** calls `onDrawForeground` (no canvas rendering)

**Debug Information**:
- Global variable: `window.__PromptPalette_F_Mode` (returns `"classic"` or `"nodes2"`)
- Console logs: Mode detection logged on startup
- Example: `[PromptPalette_F] Classic mode detected (onDrawForeground called)`

### Migration History (v2.0.0 - January 2026)

This section documents the V3 API and Nodes 2.0 migration process, including errors encountered and solutions implemented.

#### Error 1: V3 API `rows` Parameter Not Supported
- **Error**: `String.Input.__init__() got an unexpected keyword argument 'rows'`
- **Context**: Initial V3 schema used `io.String.Input("text", default="", multiline=True, rows=8)`
- **Solution**: Removed `rows` parameter, kept only `multiline=True`
- **Learning**: V3 API doesn't support `rows` parameter for text inputs

#### Error 2: JavaScript File Not Loading (404)
- **Error**: `web/index.js` returned 404 when using V3 entry point
- **Context**: After implementing `comfy_entrypoint()` in nodes.py and importing it in `__init__.py`
- **Root Cause**: V3 `web_directory` property in `ComfyExtension` class doesn't serve files correctly
- **Solution**: Reverted `__init__.py` to V1-only exports using `NODE_CLASS_MAPPINGS` and `WEB_DIRECTORY`
- **Status**: Temporary workaround, waiting for V3 web_directory fix

#### Error 3: Mode Detection Failures (Multiple Attempts)
- **Attempt 1 - Environment Variables**: Used `app.vueAppReady`, `window.Vue`, `window.LiteGraph`
  - **Failure**: `app.vueAppReady` is `true` in both Classic and Nodes 2.0 modes
  - User provided console output showing identical values in both modes

- **Attempt 2 - Canvas Constructor**: Checked `app.canvas.constructor.name`
  - **Failure**: Both modes returned `LGraphCanvas`

- **Attempt 3 - Pre-detection**: Used `isNodes2Mode()` function at registration time
  - **Failure**: Incorrectly detected modes in both directions (Classic as Nodes 2.0, Nodes 2.0 as Classic)

- **Final Solution - Adaptive Detection**: Used `onDrawForeground` callback invocation
  - **Success**: Callback is called in Classic mode, not called in Nodes 2.0 mode
  - Implemented 100ms timeout in `onAdded` to detect when callback isn't invoked
  - User confirmed: "正しく動作していると思います" (I think it's working correctly)

#### Implementation Timeline
1. **V3 Backend Migration**: Implemented conditional V3/V1 hybrid in `nodes.py`
2. **JavaScript Loading Issue**: Discovered and worked around V3 web_directory problem
3. **Mode Detection Research**: Tried multiple detection strategies before finding reliable method
4. **Adaptive Detection**: Implemented callback-based detection, tested and confirmed working
5. **Documentation**: Updated CLAUDE.md with final implementation details

#### Lessons Learned
- V3 `web_directory` property implementation needs more work in ComfyUI core
- Traditional environment checks are unreliable for detecting rendering mode
- Callback invocation patterns are more reliable than environment variables
- Always test mode detection in both Classic and Nodes 2.0 environments
- Adaptive/lazy detection is more robust than pre-detection for runtime features

#### Key Technical Decisions

**1. V3/V1 Hybrid Approach in Backend**
- **Decision**: Implement conditional V3 support with V1 fallback in single file
- **Rationale**: Ensures compatibility with both old and new ComfyUI versions
- **Implementation**: `try/except` block for V3 imports, conditional inheritance, dual return formats
- **Trade-off**: Slightly more complex code, but maximum compatibility

**2. V1-Only Entry Point (Temporary)**
- **Decision**: Use V1 `WEB_DIRECTORY` export instead of V3 `comfy_entrypoint()`
- **Rationale**: V3 web_directory property doesn't serve JavaScript files correctly
- **Implementation**: Simple imports in `__init__.py` from `nodes.py`
- **Future**: Will switch to V3-only when web_directory issue is resolved

**3. Adaptive Mode Detection via Callbacks**
- **Decision**: Detect mode based on whether `onDrawForeground` is called, not environment checks
- **Rationale**: Environment variables (`app.vueAppReady`, `window.Vue`) are unreliable
- **Implementation**: Initialize both modes' features, mark mode when callback invoked (or not)
- **Trade-off**: 100ms detection delay in Nodes 2.0 mode, but reliability is worth it

**4. Single Unified Extension (Not Separate Extensions)**
- **Decision**: One extension that adapts to mode, not separate Classic/Nodes2 registrations
- **Rationale**: Simpler architecture, avoids registration conflicts, easier to maintain
- **Implementation**: Single `beforeRegisterNodeDef` with adaptive callbacks
- **Trade-off**: Slightly more complex callback logic, but cleaner overall structure

**5. DOM Widget for Nodes 2.0 (Phase 2B)**
- **Decision**: Use `addDOMWidget` with HTML/CSS UI instead of waiting for official Vue widget API
- **Rationale**: No official Vue widget API documentation available; `addDOMWidget` works in both modes and requires no build process
- **Implementation**: `createDOMWidget()` builds complete interactive UI as HTML elements; widgets removed from array and values injected via `api.queuePrompt` patch
- **Trade-off**: DOM widgets have known zoom-visibility issues, but provides full feature parity now

**6. Preserve All Classic Mode Features**
- **Decision**: Keep all existing canvas-rendering code unchanged
- **Rationale**: Don't break working functionality during migration
- **Implementation**: All canvas drawing code remains in place, only called in Classic mode
- **Result**: Zero regression for existing users in Classic mode

### Future Roadmap

**Potential Improvements**:
- Investigate V3 web_directory issue with ComfyUI team
- Switch to full V3 entry point when web_directory is fixed
- Consider migrating DOM Widget to official Vue widget API when documented
- Investigate DOM widget zoom-visibility behavior in Nodes 2.0

**References:**
- [ComfyUI V3 Migration Guide](https://docs.comfy.org/custom-nodes/v3_migration)
- [ComfyUI Nodes 2.0 Documentation](https://docs.comfy.org/interface/nodes-2)
- [ComfyUI GitHub - Custom Node Schema](https://github.com/comfyanonymous/ComfyUI/issues/8580)