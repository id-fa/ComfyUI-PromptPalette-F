# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ComfyUI-PromptPalette-F is a custom node for ComfyUI that provides an interactive prompt editing interface with checkbox-based phrase toggling and weight adjustment controls.

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

1. **PromptPalette_F Node (V3/V1 Hybrid)** (`nodes.py:21-167`):
   - **Conditional V3 Schema** (lines 23-64): Defined via `define_schema()` classmethod when V3 available
     - Input types: Uses `io.String.Input()` and `io.Boolean.Input()` (not string-based)
     - Important: `rows` parameter not supported by V3 API (removed after initial error)
   - **V1 INPUT_TYPES** (lines 67-84): Always defined for backward compatibility
     - String-based types: `"STRING"`, `"BOOLEAN"`
     - Uses `forceInput` (V1 style) instead of `force_input` (V3 style)
   - **Execution**: `execute()` classmethod processes text (lines 106-167)
   - **Preview override**: `preview_override` parameter enables temporary prompt editing from frontend; when non-empty, bypasses all text processing and returns override text directly (lines 110-115)
   - Processes multiline text input by filtering commented lines (lines starting with `//` or `#`)
   - Handles inline comments by splitting on `//` and keeping only the content before
   - Uses custom separator (default: `, `) to join non-commented lines
   - Supports empty separator for no spacing/newlines between phrases
   - Combines result with optional prefix input using the same separator
   - Supports adding newline at end of output (`add_newline` parameter)
   - Supports adding newline after separator (`separator_newline` parameter)
   - Supports trailing separator (`trailing_separator` parameter)
   - **Group tag filtering**: Removes group tags `[group]` from output using `remove_group_tags_with_escape()` staticmethod (lines 91-104)
   - **Escape character support**: Preserves literal brackets using `\[` and `\]` escape sequences
   - **Conditional return format**: Returns `io.NodeOutput()` if V3 available, tuple otherwise (lines 163-167)
   - **V3 Extension** (lines 170-181): Only defined if V3 API available, exported via `comfy_entrypoint()` async function

2. **Web Extension - Adaptive Dual Mode** (`web/index.js`):
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
     - `api.queuePrompt` patch injects all values from `_ppWidgetRefs` into prompt data at execution time

3. **UI System**:
   - **Edit mode**: Shows standard multiline text widget, separator input, and newline options for direct editing
   - **Display mode**: Custom-drawn interface with checkboxes, phrase text, weight controls, and group controls
   - **Interactive elements**: Checkboxes for toggling comments, +/- buttons for weight adjustment, group toggle buttons, global toggle buttons, clickable text areas
   - **Row selection**: Click anywhere on phrase text to toggle (excludes weight control buttons on right)
   - **Visual feedback**: Different colors for active/inactive text, bold text for weighted phrases
   - **Text wrapping**: Long phrases automatically wrap within node boundaries
   - **Description comments**: `#` comments display as italic explanatory text above phrases
   - **Group controls**: Horizontal row with global `[all]`/`[off]` buttons (green/red) followed by group buttons for batch phrase control

### Advanced Features

4. **Custom Separator System** (`nodes.py:43-89`):
   - Configurable separator input parameter (default: `, `)
   - Empty separator support for no spacing between phrases
   - Consistent separator usage for prefix concatenation
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
   - **Frontend-to-backend communication**: `setup()` patches `api.queuePrompt` to inject `_promptPalette_previewOverride` into prompt data before HTTP request
   - **State management**: Override stored on `node._promptPalette_previewOverride` property; synced to hidden `preview_override` widget if available
   - **Helper functions**: `setPreviewOverride(node, value)`, `getPreviewOverride(node)`, `openPreviewEditor(node)`, `findOverrideWidget(node)`
   - **Auto-clear**: Override automatically clears when source text changes (checkbox toggle, group toggle, direct text edit)
   - **Clickable area integration**: `preview_edit` and `preview_reset` actions in `handleClickableAreaAction()`

13. **Dynamic Widget Height System** (`web/index.js:449-468`):
   - **Automatic height calculation**: `getWidgetsTotalHeight()` dynamically calculates widget area height
   - **Hidden widget handling**: Skips hidden widgets (text, separator, etc.) when calculating height
   - **ComfyUI version compatibility**: Adapts to different ComfyUI versions automatically
   - **Flexible spacing**: Uses `CONFIG.widgetSpacing` (5px) for minimal gap between widgets and content
   - **Layout optimization**: Ensures buttons are visible and content is properly positioned regardless of ComfyUI version

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
   - Verify all widget values are correctly passed to backend via queuePrompt patch

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
- **Preview override**: Temporary edit stored on `node._promptPalette_previewOverride`, injected into prompt via `api.queuePrompt` patch, auto-cleared on source text change
- **HTML overlay pattern**: `openPreviewEditor()` creates `position: fixed` container with toolbar + textarea, uses canvas coordinate transform for positioning, manages focus with `setTimeout` delays to avoid LiteGraph interference
- **Reload Node recovery**: Initial workflow state snapshotted on first `configure()` into `app.graph._ppInitialStates[nodeId]`. Because ComfyUI's Reload Node assigns a **new id** to the recreated instance, a `onRemoved` → `onAdded` bridge (`app.graph._ppPendingReload`) transfers the saved state and re-keys it under the new id. Graph-level state cleared via patched `LGraph.prototype.clear` on workflow switch.
- **State management**: Node tracks edit mode, clickable areas, widget visibility, text wrapping, and preview override
- **Canvas redrawing**: Triggered via `app.graph.setDirtyCanvas(true)` after state changes

## Code Organization

### web/index.js Structure (approx. 2,600+ lines):
- **Imports**: `app` from ComfyUI app.js, `api` from ComfyUI api.js
- **Configuration**: CONFIG object with UI constants, including widgetSpacing
- **Group Parsing Functions**: Group tag extraction, status tracking, simplified toggle logic, global toggles
- **Unified Extension Registration**: Single "PromptPalette_F" extension with adaptive mode detection
  - `setup()`: Patches `api.queuePrompt` to inject widget values (Nodes 2.0) and preview override (both modes)
  - `setupAdaptiveMode()`: Main setup function
  - `onNodeCreated`: Initializes widgets for both modes, creates warning widgets (removed later in Nodes 2.0)
  - `onDrawForeground`: Canvas rendering callback (Classic mode only) - creates buttons, draws UI
  - `onDrawBackground`: Background rendering callback (both modes) - mode detection and widget management
  - `onAdded`: (1) `setTimeout(0)` Reload Node recovery — restores initial state from `_ppPendingReload` if set within 500ms; (2) 100ms delayed Nodes 2.0 detection — creates DOM Widget UI
  - `onRemoved`: Captures the node's saved initial state into `app.graph._ppPendingReload` so the next new instance (Reload Node assigns a new id) can inherit it
  - `configure()`: Snapshots first-time `info` into `app.graph._ppInitialStates[nodeId]` (only on workflow load, not on subsequent edits) for later Reload Node recovery
- **UI Control Functions**: Widget management, click handling, interaction (Classic mode only)
  - `addEditButton()`: Creates Edit and Hide Preview buttons (called in Classic mode only)
  - `findWidgetByName()`: Unified widget lookup with `_ppWidgetRefs` fallback for Nodes 2.0
  - Button creation, text widget handling, separator controls
- **Text Wrapping Utilities**: Dynamic widget height calculation, text wrapping, width calculation
- **Drawing Functions**: Canvas rendering for checkboxes, phrases, group controls, weight buttons, clickable text areas (Classic mode only)
- **Weight System**: Parsing, adjustment, formatting for `(text:weight)` notation
- **Theme/Color System**: Dynamic theme integration, color caching
- **Nodes 2.0 DOM Widget UI**: Full HTML/CSS-based interactive UI for Nodes 2.0 mode
  - `DOM_CSS`: Complete CSS styles using ComfyUI theme variables
  - `injectDOMCSS()`: One-time CSS injection into document head
  - `createDOMWidget()`: Builds interactive UI (checkboxes, weights, groups, preview, edit mode)
  - `setupNodes2DOMWidget()`: Registers DOM Widget via `addDOMWidget` with dynamic height
- **Preview Override Functions**: `findOverrideWidget()`, `setPreviewOverride()`, `getPreviewOverride()`, `openPreviewEditor()` (HTML textarea overlay with toolbar)
- **Preview System**: Preview generation, rendering, scrolling, edit/reset buttons (Classic mode only)
- **Entry Point**: Extension registration

### nodes.py Structure (188 lines):
- **V3 API Conditional Imports**: Lines 4-12 (try/except block for comfy_api.latest imports, V3_AVAILABLE flag, dummy ComfyNode class)
- **Base Class Selection**: Lines 14-18 (conditionally inherit from io.ComfyNode or object)
- **Class Definition**: Lines 21-167 (PromptPalette_F class with conditional V3/V1 support)
  - Lines 23-64: Conditional V3 `define_schema()` classmethod (includes `preview_override` optional input)
  - Lines 67-84: V1 `INPUT_TYPES()` classmethod (includes `preview_override` in optional)
  - Lines 86-88: V1-style class attributes (RETURN_TYPES, FUNCTION, CATEGORY)
  - Lines 91-104: `remove_group_tags_with_escape()` staticmethod
  - Lines 106-167: `execute()` classmethod with `preview_override` early return and conditional return format
- **V3 Extension**: Lines 170-181 (PromptPaletteExtension and comfy_entrypoint, only if V3_AVAILABLE)
- **V1 Legacy Exports**: Lines 184-188 (NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS, WEB_DIRECTORY - always defined)

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