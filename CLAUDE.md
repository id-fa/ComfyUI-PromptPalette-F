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
- **Nodes 2.0 Mode (Vue.js)**: Basic support - text editing only, advanced features disabled
- **Adaptive Mode Detection**: Uses `onDrawForeground` callback invocation as mode indicator
  - If `onDrawForeground` called → Classic mode (canvas rendering works)
  - If `onDrawForeground` not called after 100ms → Nodes 2.0 mode (canvas rendering unavailable)
  - Why adaptive: Traditional detection methods (`app.vueAppReady`, `window.Vue`, `window.LiteGraph`) are unreliable
- Mode selection logged to console for debugging
- Global `window.__PromptPalette_F_Mode` variable tracks current mode

### Core Components

1. **PromptPalette_F Node (V3/V1 Hybrid)** (`nodes.py:21-153`):
   - **Conditional V3 Schema** (lines 23-59): Defined via `define_schema()` classmethod when V3 available
     - Input types: Uses `io.String.Input()` and `io.Boolean.Input()` (not string-based)
     - Important: `rows` parameter not supported by V3 API (removed after initial error)
   - **V1 INPUT_TYPES** (lines 62-78): Always defined for backward compatibility
     - String-based types: `"STRING"`, `"BOOLEAN"`
     - Uses `forceInput` (V1 style) instead of `force_input` (V3 style)
   - **Execution**: `execute()` classmethod processes text (lines 101-151)
   - Processes multiline text input by filtering commented lines (lines starting with `//` or `#`)
   - Handles inline comments by splitting on `//` and keeping only the content before
   - Uses custom separator (default: `, `) to join non-commented lines
   - Supports empty separator for no spacing/newlines between phrases
   - Combines result with optional prefix input using the same separator
   - Supports adding newline at end of output (`add_newline` parameter)
   - Supports adding newline after separator (`separator_newline` parameter)
   - Supports trailing separator (`trailing_separator` parameter)
   - **Group tag filtering**: Removes group tags `[group]` from output using `remove_group_tags_with_escape()` staticmethod (lines 84-98)
   - **Escape character support**: Preserves literal brackets using `\[` and `\]` escape sequences
   - **Conditional return format**: Returns `io.NodeOutput()` if V3 available, tuple otherwise (lines 150-153)
   - **V3 Extension** (lines 157-167): Only defined if V3 API available, exported via `comfy_entrypoint()` async function

2. **Web Extension - Adaptive Dual Mode** (`web/index.js`):
   - **Single Unified Registration**: Single extension "PromptPalette_F" that adapts to rendering mode
   - **Adaptive Mode Detection via Callbacks**:
     - `onNodeCreated`: Sets up both Classic and Nodes 2.0 features initially
       - Initializes `_promptPalette_drawCalled` and `_promptPalette_setupDone` flags
       - Stores reference to text widget for later button creation
       - Creates 3 Nodes 2.0 warning widgets (hidden initially):
         - "⚠️ Nodes 2.0 Mode" (status indicator)
         - "Use // to toggle lines" (usage instruction)
         - "Switch to Classic for full UI" (feature availability)
     - `onDrawForeground`: Canvas rendering callback - ONLY invoked in Classic mode
       - Sets `_promptPalette_foregroundDrawnThisFrame` flag for mode detection
       - When called first time: Creates Edit/Hide Preview buttons, marks as Classic mode
       - Performs custom canvas drawing for checkboxes, groups, weights, preview
     - `onDrawBackground`: Background rendering callback - works in both modes
       - Checks `_promptPalette_foregroundDrawnThisFrame` flag to detect current mode
       - Dynamically shows/hides warning widgets based on mode
       - Note: Button visibility control doesn't work without page reload
     - `onAdded`: Delayed detection with 100ms timeout (fallback for initial detection)
       - If `onDrawForeground` wasn't called: Marks as Nodes 2.0 mode, shows warning widgets
       - Makes all input widgets visible (no custom edit mode in Nodes 2.0)
   - **Why Adaptive Detection**:
     - `app.vueAppReady` is `true` in both Classic and Nodes 2.0 modes (unreliable)
     - `window.Vue` and `window.LiteGraph` checks are unreliable
     - Canvas callback invocation is the only reliable indicator

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

11. **Preview System** (`web/index.js:1107-1346`):
   - **Real-time preview**: Displays processed output in preview area at bottom of node
   - **Text generation**: `generatePreview()` replicates Python processing logic (lines 1107-1130)
   - **Text processing**: `processTextForPreview()` mirrors backend `process()` method (lines 1132-1176)
   - **Group tag removal**: Automatically removes group tags `[group]` from preview using `removeGroupTags()` (line 1122)
   - **Escape character support**: Preserves literal brackets `\[` `\]` in preview output
   - **Scrollable display**: Preview supports scrolling for long output with scroll buttons
   - **Scroll management**: Tracks scroll offset and calculates max scroll based on line count
   - **Visual rendering**: `drawPreview()` handles canvas drawing with proper layout (lines 1178-1275)
   - **Scroll controls**: `drawScrollBar()` and `drawScrollButton()` provide interactive scrolling (lines 1277-1346)
   - **Toggle functionality**: "Show Preview" / "Hide Preview" button to control visibility
   - **Automatic text wrapping**: Preview text wraps within available width
   - **Theme integration**: Uses theme colors for consistent appearance

12. **Dynamic Widget Height System** (`web/index.js:449-468`):
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

#### Nodes 2.0 Mode Testing (Basic Support)
1. **Mode Verification**:
   - Enable Nodes 2.0 in ComfyUI settings (usually under Interface)
   - Open browser console, look for: `[PromptPalette_F] Nodes 2.0 mode detected (onDrawForeground not called)`
   - Check `window.__PromptPalette_F_Mode` returns `"nodes2"`

2. **Basic Functionality**:
   - Create PromptPalette-F node
   - Verify warning widget is visible
   - Test text input (multiline editing)
   - Test all input parameters (separator, prefix, output options)
   - Verify backend processing produces correct output

3. **Expected Limitations**:
   - No Edit/Display mode toggle
   - No interactive checkboxes
   - No weight adjustment controls
   - No group buttons
   - No preview panel
   - All features work through standard widget inputs only

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

## Key Patterns

- **Comment system**: `//` for toggle comments (filtered/unfiltered), `#` for description comments (display only)
- **Group system**: `[group]` tags for batch phrase control, support for multiple tags per line, escape with `\[` `\]`
- **Custom separator**: Configurable text joining with empty string support for no spacing
- **Output formatting options**: `add_newline` for end-of-output newline, `separator_newline` for separator newlines, `trailing_separator` for separator after last phrase
- **Text wrapping**: Word-based wrapping with dynamic width calculation and height adjustment
- **Weight adjustment**: Uses regex parsing to handle `(text:weight)` notation
- **Canvas interaction**: Mouse clicks are mapped to clickable areas (checkboxes, text areas, weight buttons, group buttons, global toggle buttons)
- **Row selection**: Entire phrase text area is clickable for toggling (excluding weight controls on right edge)
- **State management**: Node tracks edit mode, clickable areas, widget visibility, and text wrapping
- **Canvas redrawing**: Triggered via `app.graph.setDirtyCanvas(true)` after state changes

## Code Organization

### web/index.js Structure (approx. 1,500+ lines):
- **Configuration**: CONFIG object with UI constants, including widgetSpacing
- **Group Parsing Functions**: Group tag extraction, status tracking, simplified toggle logic, global toggles
- **Unified Extension Registration**: Single "PromptPalette_F" extension with adaptive mode detection
  - `setupAdaptiveMode()`: Main setup function
  - `onNodeCreated`: Initializes widgets for both modes, creates 3 warning widgets for Nodes 2.0
  - `onDrawForeground`: Canvas rendering callback (Classic mode only) - creates buttons, draws UI
  - `onDrawBackground`: Background rendering callback (both modes) - dynamic mode detection and widget visibility control
  - `onAdded`: Delayed detection with 100ms timeout (fallback for initial Nodes 2.0 detection)
- **UI Control Functions**: Widget management, click handling, interaction (Classic mode only)
  - `addEditButton()`: Creates Edit and Hide Preview buttons (called in Classic mode only)
  - Button creation, text widget handling, separator controls
- **Text Wrapping Utilities**: Dynamic widget height calculation, text wrapping, width calculation
- **Drawing Functions**: Canvas rendering for checkboxes, phrases, group controls, weight buttons, clickable text areas (Classic mode only)
- **Weight System**: Parsing, adjustment, formatting for `(text:weight)` notation
- **Theme/Color System**: Dynamic theme integration, color caching
- **Preview System**: Preview generation, rendering, scrolling (Classic mode only)
- **Entry Point**: Extension registration

### nodes.py Structure (175 lines):
- **V3 API Conditional Imports**: Lines 4-12 (try/except block for comfy_api.latest imports, V3_AVAILABLE flag, dummy ComfyNode class)
- **Base Class Selection**: Lines 14-18 (conditionally inherit from io.ComfyNode or object)
- **Class Definition**: Lines 21-153 (PromptPalette_F class with conditional V3/V1 support)
  - Lines 23-59: Conditional V3 `define_schema()` classmethod (only if V3_AVAILABLE)
  - Lines 62-78: V1 `INPUT_TYPES()` classmethod (always defined)
  - Lines 80-82: V1-style class attributes (RETURN_TYPES, FUNCTION, CATEGORY)
  - Lines 84-98: `remove_group_tags_with_escape()` staticmethod
  - Lines 101-153: `execute()` classmethod with conditional return format
- **V3 Extension**: Lines 157-167 (PromptPaletteExtension and comfy_entrypoint, only if V3_AVAILABLE)
- **V1 Legacy Exports**: Lines 171-173 (NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS, WEB_DIRECTORY - always defined)

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
- ✅ Scroll functionality: Preview scrolling with visible scroll bar (visibility bug fixed)
- ✅ Group toggle: Multi-group support (interference bug resolved)
- ✅ Row selection: Clickable phrase text areas
- ✅ Dynamic sizing: Widget height system for ComfyUI version compatibility
- ✅ Weight controls: +/- buttons for weight adjustment
- ✅ Edit/Display modes: Toggle between text editing and interactive UI

#### Nodes 2.0 Mode (Vue.js): ⚠️ Basic Support Only (Phase 2A Complete)
- ✅ **Adaptive mode detection**: Based on `onDrawForeground` callback invocation
  - Tested and working correctly in both Classic and Nodes 2.0 environments
  - Fixes issue where `app.vueAppReady` is true in both modes
- ✅ **Text editing**: All input widgets visible and functional
- ✅ **Backend processing**: Full text processing (same as Classic mode)
- ✅ **Warning display**: Shows limitation notice to users (3 separate widgets)
  - "⚠️ Nodes 2.0 Mode"
  - "Use // to toggle lines" (explains comment-based toggling)
  - "Switch to Classic for full UI" (directs users to full features)
- ⚠️ **Visual issues**: Edit/Hide Preview buttons remain visible (non-functional), empty text fields appear
- ❌ **Advanced features**: Not available (Phase 2B - waiting for ComfyUI Vue API documentation)
  - Interactive checkboxes
  - Weight adjustment controls
  - Group management buttons
  - Live preview panel
  - Edit/display mode toggling

## Known Issues

### V3 web_directory Property (Ongoing)
- **Issue**: V3 `ComfyExtension.web_directory` property doesn't serve JavaScript files correctly
- **Manifestation**: `web/index.js` returns 404 when using V3 entry point via `comfy_entrypoint()`
- **Current Workaround**: Using V1 `WEB_DIRECTORY` export in `__init__.py`
- **Impact**: Prevents full V3-only implementation, requires V1/V3 hybrid approach
- **Status**: Under investigation, may be ComfyUI core issue
- **Code Location**: `__init__.py:1-5`, `nodes.py:157-173`

### Warning Widget Text Wrapping in Nodes 2.0 Mode (Partially Resolved)
- **Issue**: Single multiline text widget doesn't wrap text properly in Nodes 2.0 mode
- **Original Text**: "⚠️ Limited Support" / "Advanced features require Classic mode.\nSwitch in ComfyUI settings."
- **Attempted Fix 1**: Changed to shorter multi-line text (not effective - newlines ignored)
- **Attempted Fix 2**: Split into 3 separate text widgets (partially effective)
  - Widget 1: "⚠️ Nodes 2.0 Mode"
  - Widget 2: "Use // to toggle lines"
  - Widget 3: "Switch to Classic for full UI"
- **Remaining Issue**: Empty text fields appear alongside the warning widgets
- **Impact**: Minor UX issue - warning message now readable but with extra visual clutter
- **Status**: Acceptable workaround implemented, further improvements possible
- **Code Location**: `web/index.js:201-233`

### Mode Detection Reliability (Partially Resolved)
- **Issue**: Traditional mode detection methods are unreliable
- **Problems Found**:
  - `app.vueAppReady` is `true` in both Classic and Nodes 2.0 modes
  - `window.Vue` and `window.LiteGraph` presence checks are inconsistent
  - `app.ui.settings.getSettingValue('Comfy.UseNewUI')` not reliable
- **Solution**: Implemented adaptive detection using `onDrawForeground` callback invocation
  - Classic mode: `onDrawForeground` is called by LiteGraph.js rendering system
  - Nodes 2.0 mode: `onDrawForeground` is never called by Vue.js rendering system
- **Status**: ✅ Working correctly with adaptive detection
- **Code Location**: `web/index.js:159-244`

### Classic Mode Button Visibility in Nodes 2.0 Mode (Unresolved)
- **Issue**: Edit and Hide Preview buttons remain visible when switching from Classic to Nodes 2.0 mode without page reload
- **Context**: ComfyUI allows dynamic mode switching without page reload (layer switching, not full reload)
- **Root Cause**: Button widgets' `hidden` property doesn't work properly in Nodes 2.0 mode (unlike text widgets)
- **Attempted Solutions**:
  1. Setting `widget.hidden = true` - doesn't hide button widgets
  2. Using `computeSize()` to return `[0, 0]` - not invoked dynamically
  3. Removing from `node.widgets` array in `onDrawBackground` - doesn't update UI without reload
  4. Dynamic creation/deletion in `onDrawBackground` - doesn't update UI without reload
- **Current Behavior**:
  - With page reload: Buttons correctly hidden/shown based on mode ✅
  - Without page reload: Buttons from previous mode remain visible ❌
- **Impact**: Minor UX issue - buttons are visible but non-functional in Nodes 2.0 mode
- **Decision**: Issue accepted as limitation of Vue.js rendering system
- **Status**: Will not fix - workaround requires page reload
- **Code Location**: `web/index.js:314-373` (attempted `onDrawBackground` solution)

## Fixed Issues

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
  - ✅ Custom canvas rendering
  - ✅ Edit/display mode toggling
  - ✅ Text wrapping and dynamic sizing
  - ✅ Theme-aware color system

#### Nodes 2.0 Mode (Vue.js) - Basic Support ⚠️
- **Status**: Minimal implementation (Phase 2A complete)
- **Compatibility**: ComfyUI v0.3.76+ with Nodes 2.0 enabled
- **Supported Features**:
  - ✅ Text editing (multiline input)
  - ✅ All input parameters (separator, prefix, output options)
  - ✅ Backend text processing (same as Classic mode)
- **Unavailable Features** (require Classic mode):
  - ⚠️ Interactive checkboxes
  - ⚠️ Weight adjustment controls
  - ⚠️ Group management buttons
  - ⚠️ Live preview panel
  - ⚠️ Custom canvas rendering
  - ⚠️ Edit/display mode toggling

**User Guidance:**
- Node displays 3 warning widgets in Nodes 2.0 mode:
  - "⚠️ Nodes 2.0 Mode" (status indicator)
  - "Use // to toggle lines" (explains comment-based phrase toggling)
  - "Switch to Classic for full UI" (directs to full feature set)
- Users can toggle between Classic and Nodes 2.0 modes in ComfyUI settings
- **Important**: After switching modes, reload the page for proper UI update
  - Without reload: Buttons from previous mode may remain visible (but non-functional)
  - With reload: UI correctly reflects current mode
- Mode selection automatically detected and logged to console

### Mode Detection Strategy

**Adaptive Detection via Callback Invocation** (`web/index.js:159-244`):

The extension uses an **adaptive detection approach** that determines the rendering mode based on whether canvas drawing callbacks are invoked, rather than checking environment variables upfront.

**How It Works**:
1. **Node Creation** (`onNodeCreated`): Sets up features for both modes initially
   - Creates all widgets (hidden by default)
   - Initializes detection flags: `_promptPalette_drawCalled`, `_promptPalette_setupDone`
   - Creates 3 warning widgets for Nodes 2.0 mode
   - Stores text widget reference for later button creation

2. **Canvas Drawing** (`onDrawForeground`): Only invoked in Classic mode
   - Sets `_promptPalette_foregroundDrawnThisFrame` flag
   - If called first time → Creates Edit/Hide Preview buttons, marks as Classic mode
   - Hides Nodes 2.0 warning widgets
   - Performs custom canvas drawing
   - Sets `window.__PromptPalette_F_Mode = 'classic'`

3. **Background Drawing** (`onDrawBackground`): Invoked in both modes (attempted dynamic mode switching)
   - Checks `_promptPalette_foregroundDrawnThisFrame` flag to detect current mode
   - Shows/hides warning widgets based on mode
   - Note: Button visibility control doesn't work without page reload (Vue.js limitation)

4. **Delayed Detection** (`onAdded`): Checks after 100ms timeout (fallback for initial detection)
   - If `onDrawForeground` wasn't called → Marks as Nodes 2.0 mode
   - Shows warning widgets, makes input widgets visible
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

**5. Minimal Nodes 2.0 Support (Phase 2A)**
- **Decision**: Implement basic text editing only, defer advanced features to Phase 2B
- **Rationale**: No official Vue widget API documentation available yet
- **Implementation**: Warning widget + visible input widgets, no custom UI
- **Trade-off**: Limited features in Nodes 2.0, but users can still use the node for basic tasks

**6. Preserve All Classic Mode Features**
- **Decision**: Keep all existing canvas-rendering code unchanged
- **Rationale**: Don't break working functionality during migration
- **Implementation**: All canvas drawing code remains in place, only called in Classic mode
- **Result**: Zero regression for existing users in Classic mode

### Future Roadmap

**Phase 2B: Full Nodes 2.0 Support** (Planned)
- Waiting for ComfyUI Vue widget API documentation
- Will implement Vue.js components for:
  - Interactive checkboxes
  - Weight controls
  - Group buttons
  - Preview panel
- Target: Feature parity between Classic and Nodes 2.0 modes

**Potential Improvements**:
- Fix warning widget text wrapping in Nodes 2.0 mode
- Investigate V3 web_directory issue with ComfyUI team
- Switch to full V3 entry point when web_directory is fixed
- Consider custom Vue.js widget implementation when API is documented

**References:**
- [ComfyUI V3 Migration Guide](https://docs.comfy.org/custom-nodes/v3_migration)
- [ComfyUI Nodes 2.0 Documentation](https://docs.comfy.org/interface/nodes-2)
- [ComfyUI GitHub - Custom Node Schema](https://github.com/comfyanonymous/ComfyUI/issues/8580)

## Vue.js Implementation (In Progress - January 2026)

This section documents the experimental Vue.js-based implementation for PromptPalette-F, which aims to provide a modern UI using Vue 3 and ComponentWidgetImpl.

### Architecture Overview

**New Node: PromptPalette_F_Vue**
- Separate node alongside existing PromptPalette_F (Classic canvas-based)
- Uses ComfyUI's `ComponentWidgetImpl` for Vue.js integration
- Custom widget type: `PROMPT_PALETTE_VUE`
- Only works in Classic mode (ComponentWidgetImpl limitation)

**Build System:**
- Vue 3.5.13 with TypeScript
- Vite 6.4.1 for bundling
- Output: `web/promptpalette-vue.js` (49KB, gzip 15KB)
- CSS: `web/vue-assets/promptpalette-vue.css` (5.8KB)
- Important: `emptyOutDir: false` in vite.config.mts to preserve `web/index.js`

**File Structure:**
- `src/main.ts`: Extension registration and ComponentWidgetImpl setup
- `src/components/PromptPaletteWidget.vue`: Main Vue component with full UI
- `src/components/PhraseRow.vue`: Individual phrase row with checkbox and weight controls
- `src/components/GroupControls.vue`: Group toggle buttons
- `src/components/PreviewPanel.vue`: Live preview panel
- `nodes.py`: Added `PromptPalette_F_Vue` class (V1 API only, no V3 schema)

### Implementation Progress

#### ✅ Completed Features

1. **Vue UI Display** (Completed)
   - All Vue components render correctly in Classic mode
   - ComponentWidgetImpl successfully integrated with ComfyUI
   - Edit mode and Display mode toggle working
   - Preview panel shows/hides correctly

2. **serializeValue Implementation** (Completed)
   - Set up in Vue component's `onMounted()` lifecycle hook
   - Returns widget data as dictionary to Python backend
   - Python backend successfully receives data on execution

3. **Execution Caching Solution** (Completed)
   - Added `_cache_bust` field with timestamp (`Date.now()`)
   - Prevents ComfyUI from caching identical inputs
   - Every execution now triggers Python `execute()` method

4. **Python Backend Integration** (Completed)
   - `PromptPalette_F_Vue.execute()` receives Vue widget data
   - Text processing logic works correctly
   - Output generation functional

#### ⚠️ Critical Issue: Vue Props Reactivity Problem

**Problem Description:**
Checkbox state changes do not update the underlying `textContent` data correctly. The PhraseRow component always receives the initial `props.line` value, not the updated value after toggle.

**Symptoms:**
```
1st click: propsLine: 'beautiful landscape' → newLine: '// beautiful landscape' ✅
2nd click: propsLine: 'beautiful landscape' → newLine: '// beautiful landscape' ❌ (should remove //)
3rd click: propsLine: 'beautiful landscape' → newLine: '// beautiful landscape' ❌
```

**Root Cause Analysis:**
- `textContent` ref updates correctly: `'beautiful landscape'` → `'// beautiful landscape'`
- `lines` computed updates correctly: `['beautiful landscape', ...]` → `['// beautiful landscape', ...]`
- BUT `PhraseRow` component's `props.line` doesn't receive the updated value
- This is a Vue reactivity issue with `v-for` and props passing

**Attempted Solutions (All Failed):**

1. **Changed `:key` binding** (`web/index.js:87`)
   - From: `:key="index"`
   - To: `:key="`${index}-${line}`"`
   - Result: No effect, props still not updating

2. **Changed props binding** (`web/index.js:96`)
   - From: `:line="line"` (v-for loop variable)
   - To: `:line="lines[index]"` (direct array access)
   - Result: No effect, props still not updating

3. **Added detailed logging**
   - Confirmed `handleLineUpdate` receives correct data
   - Confirmed `textContent.value` updates correctly
   - Confirmed `lines.value` (computed) updates correctly
   - BUT `PhraseRow` component doesn't see the update

**Next Steps to Try:**

1. **Remove or simplify `:key` attribute**
   - Try `:key="index"` or remove key entirely
   - Vue might be reusing components incorrectly with complex keys

2. **Use `watch` in PhraseRow component**
   - Add `watch(() => props.line, ...)` to detect prop changes
   - Log when prop actually changes in child component

3. **Refactor state management**
   - Move checkbox state to parent component
   - Pass down state and toggle handler separately
   - Avoid relying on text parsing for state

4. **Use `v-model` instead of `:checked` + `@change`**
   - Create computed getter/setter in PhraseRow
   - Sync with parent via emit

5. **Force component re-creation**
   - Use unique IDs instead of array index in `:key`
   - Force Vue to destroy and recreate components on change

### Known Limitations

1. **Classic Mode Only**
   - ComponentWidgetImpl doesn't work in Nodes 2.0 mode
   - Vue UI only available in Classic mode
   - This is a ComfyUI limitation, not our implementation

2. **Props Reactivity Issue**
   - Checkbox toggles don't work correctly (see above)
   - Currently blocks full functionality
   - Requires architectural changes to resolve

3. **Build Process Required**
   - Unlike canvas-based implementation, requires npm build step
   - Changes to Vue components need rebuild and browser refresh
   - Added complexity for development

### Development Commands

```bash
# Install dependencies
npm install

# Build Vue components
npm run build

# Output files
# - web/promptpalette-vue.js
# - web/vue-assets/promptpalette-vue.css
```

### Code Locations

**Backend:**
- `nodes.py:160-220`: PromptPalette_F_Vue class
- `nodes.py:237-240`: NODE_CLASS_MAPPINGS with Vue node

**Frontend:**
- `src/main.ts:15-76`: Extension registration
- `src/components/PromptPaletteWidget.vue:192-210`: handleLineUpdate function (props issue)
- `src/components/PromptPaletteWidget.vue:252-277`: updateWidgetValue function
- `src/components/PromptPaletteWidget.vue:279-299`: serializeValue setup (in onMounted)
- `src/components/PhraseRow.vue:60-93`: toggleComment function

**Build Configuration:**
- `package.json`: Dependencies and build script
- `vite.config.mts`: Vite configuration with emptyOutDir: false
- `tsconfig.json`: TypeScript configuration

### Testing Status

- ✅ Vue UI renders in Classic mode
- ✅ Python backend receives data from Vue widget
- ✅ Execution caching bypassed with _cache_bust
- ❌ Checkbox state toggling broken (props reactivity issue)
- ⏸️ Weight controls not tested (dependent on checkbox fix)
- ⏸️ Group buttons not tested (dependent on checkbox fix)
- ⏸️ Preview panel not tested (dependent on checkbox fix)

### Decision: Paused Pending Investigation

The Vue.js implementation is **paused** until the props reactivity issue is resolved. The canvas-based Classic mode implementation remains the primary, fully-functional version.

**Reason for Pause:**
- Core functionality (checkbox toggling) is broken
- Multiple attempted fixes have failed
- Requires deeper investigation into Vue reactivity patterns
- May need architectural refactoring

**Future Work:**
- Investigate Vue reactivity debugging tools
- Consider alternative state management patterns
- Test with simplified component structure
- Consult Vue.js documentation on v-for reactivity edge cases