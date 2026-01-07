# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ComfyUI-PromptPalette-F is a custom node for ComfyUI that provides an interactive prompt editing interface with checkbox-based phrase toggling and weight adjustment controls.

## Architecture

The project follows ComfyUI's custom node structure:

- **`__init__.py`**: Standard ComfyUI entry point that imports and exports node mappings and web directory
- **`nodes.py`**: Backend Python logic containing the `PromptPalette_F` class that processes text input
- **`web/index.js`**: Frontend JavaScript extension that registers with ComfyUI's app system to provide custom UI
- **`pyproject.toml`**: Project metadata and ComfyUI registry configuration following the official specification

### Core Components

1. **PromptPalette_F Node** (`nodes.py:5-91`):
   - Processes multiline text input by filtering commented lines (lines starting with `//` or `#`)
   - Handles inline comments by splitting on `//` and keeping only the content before
   - Uses custom separator (default: `, `) to join non-commented lines
   - Supports empty separator for no spacing/newlines between phrases
   - Combines result with optional prefix input using the same separator
   - Supports adding newline at end of output (`add_newline` parameter)
   - Supports adding newline after separator (`separator_newline` parameter)
   - Supports trailing separator (`trailing_separator` parameter)
   - **Group tag filtering**: Removes group tags `[group]` from output using `remove_group_tags_with_escape()` method (`nodes.py:28-41`)
   - **Escape character support**: Preserves literal brackets using `\[` and `\]` escape sequences
   - Returns formatted string output with group tags removed

2. **Web Extension** (`web/index.js:197-254`):
   - Registers as ComfyUI extension named "PromptPalette_F"
   - Hooks into `beforeRegisterNodeDef` to modify PromptPalette_F node behavior
   - Sets up node creation callback and drawing callback
   - Manages edit/display mode toggling

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
- **Manual testing**: Install in ComfyUI's `custom_nodes` directory and restart ComfyUI
- **UI verification**: Test through ComfyUI's interface - create node, toggle edit/display modes, test phrase toggling, weight adjustment, group controls, and global toggle buttons
- **Group testing**: Test with lines like `phrase1 [group1]`, `phrase2 [group1][group2]`, and escaped brackets `phrase \[literal\] [group1]`
- **Global toggle testing**: Test `[all]` and `[off]` buttons to ensure all phrases toggle correctly
- **No automated tests**: Testing is entirely manual through the ComfyUI interface

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

### web/index.js Structure:
- **Configuration**: Lines 3-26 (CONFIG object with UI constants, including widgetSpacing)
- **Group Parsing Functions**: Lines 31-147 (group tag extraction, status tracking, simplified toggle logic, global toggles)
- **Extension Registration**: Lines 149-206 (ComfyUI extension setup, callbacks)
- **UI Control Functions**: Lines 212-398 (widget management, click handling, interaction)
- **Text Wrapping Utilities**: Lines 449-489 (dynamic widget height calculation, text wrapping, width calculation)
- **Drawing Functions**: Lines 495-967 (canvas rendering, checkboxes, phrases, group controls, weight buttons, clickable text areas)
- **Comment Parsing**: Lines 665-679 (description comment handling)
- **Weight System**: Lines 972-1023 (parsing, adjustment, formatting)
- **Theme/Color System**: Lines 1029-1068 (dynamic theme integration, color caching)
- **Preview System**: Lines 1074-1313 (preview generation, rendering, scrolling)

### nodes.py Structure:
- **Class Definition**: Lines 5-91 (PromptPalette_F class)
- **Input Configuration**: Lines 7-22 (INPUT_TYPES with text, prefix, separator, output options)
- **Group Tag Processing**: Lines 28-41 (remove_group_tags_with_escape method)
- **Main Processing Logic**: Lines 43-90 (process method with filtering, joining, output formatting)
- **Node Registration**: Lines 93-95 (NODE_CLASS_MAPPINGS with display name "PromptPalette-F", WEB_DIRECTORY)

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
- Basic functionality: ✅ Working
- Preview functionality: ✅ Working (white screen bug resolved)
- Scroll functionality: ✅ Working (scroll bar visibility fixed)
- Group toggle: ✅ Working (multi-group interference bug resolved)
- Row selection: ✅ Working (clickable text areas implemented)
- ComfyUI version compatibility: ✅ Working (dynamic widget height system implemented)

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

### Supported Versions
- **Classic Mode**: ✅ Fully compatible with all recent ComfyUI versions
- **Nodes 2.0 (Beta)**: ⚠️ Limited compatibility (buttons may not be clickable)

### Nodes 2.0 Status
ComfyUI Nodes 2.0 (released December 2, 2025 in v0.3.76) represents a major architectural change from LiteGraph.js to Vue.js-based rendering.

**Current Limitations:**
- Custom widgets (Edit/Save buttons) may not respond to clicks in Nodes 2.0 mode
- No official migration guide available yet for custom node developers
- Beta status indicates potential for breaking changes

**Recommendations:**
- Use Classic mode (default) for full functionality
- Nodes 2.0 compatibility will be addressed once official migration documentation is available
- ComfyUI allows toggling between Classic and Nodes 2.0 modes in settings
- The ComfyUI team prioritizes third-party node compatibility and is working on comprehensive migration guides

**Future Plans:**
- Monitor ComfyUI GitHub issues for Nodes 2.0 custom node migration guides
- Implement Vue.js-based widgets when official patterns are documented
- Maintain backward compatibility with Classic mode

**References:**
- [ComfyUI Nodes 2.0 Documentation](https://docs.comfy.org/interface/nodes-2)
- [ComfyUI GitHub - Custom Node Schema](https://github.com/comfyanonymous/ComfyUI/issues/8580)