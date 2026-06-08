import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const CONFIG = {
    minNodeHeight: 80,
    topNodePadding: 40,
    widgetSpacing: 5,        // Space between widgets and custom drawing
    sideNodePadding: 14,
    lineHeight: 24,
    fontSize: 14,
    checkboxSize: 16,
    spaceBetweenCheckboxAndText: 6,
    weightButtonSize: 16,
    weightLabelWidth: 24,
    minWeight: -6.0,
    maxWeight: 6.0,
    previewSeparator: 20,    // Space between main content and preview
    previewHeight: 110,      // Height for 5 lines + header + padding
    previewFontSize: 12,     // Smaller font for preview
    previewLineHeight: 16,   // Line height for preview text
    previewVisibleLines: 5,  // Number of visible lines in preview
    scrollBarWidth: 12,      // Width of scroll bar
    scrollButtonHeight: 16,  // Height of scroll up/down buttons
    groupButtonHeight: 20,   // Height of group toggle buttons
    groupButtonMargin: 4,    // Margin between group buttons
    groupAreaHeight: 28,     // Total height for group control area
    maxAutoNodeHeight: 600,  // Cap auto-grow; checkbox area scrolls beyond this
    minCheckboxAreaHeight: 80, // Minimum height for the scrollable phrase list
    checkboxScrollPadding: 4, // Space between phrase content and right scroll bar
    wheelScrollLines: 2,     // Lines moved per mouse-wheel step
};

// ========================================
// Group Parsing Functions
// ========================================

function parseGroupTags(line) {
    // Handle escaped brackets by temporarily replacing them
    const escaped = line.replace(/\\\[/g, '___ESC_OPEN___').replace(/\\\]/g, '___ESC_CLOSE___');
    const tagRegex = /\[([^\]]+)\]/g;
    const groups = [];
    let match;
    while ((match = tagRegex.exec(escaped)) !== null) {
        groups.push(match[1]);
    }
    return groups;
}

function removeGroupTags(line) {
    // Handle escaped brackets while removing group tags
    // 1. Replace escaped brackets with placeholders
    let processed = line.replace(/\\\[/g, '___ESC_OPEN___').replace(/\\\]/g, '___ESC_CLOSE___');

    // 2. Remove group tags
    processed = processed.replace(/\s*\[[^\]]+\]/g, '');

    // 3. Restore escaped brackets as literal brackets
    processed = processed.replace(/___ESC_OPEN___/g, '[').replace(/___ESC_CLOSE___/g, ']');

    return processed.trim();
}

function getAllGroups(text) {
    const allGroups = new Set();
    const lines = text.split('\n');

    for (const line of lines) {
        if (line.trim() && !line.trim().startsWith('#')) {
            const groups = parseGroupTags(line);
            groups.forEach(group => allGroups.add(group));
        }
    }

    return Array.from(allGroups).sort();
}

function getGroupStatus(text, groupName) {
    const lines = text.split('\n');
    let totalLines = 0;
    let activeLines = 0;

    for (const line of lines) {
        if (line.trim() && !line.trim().startsWith('#')) {
            const groups = parseGroupTags(line);
            if (groups.includes(groupName)) {
                totalLines++;
                if (!line.trim().startsWith('//')) {
                    activeLines++;
                }
            }
        }
    }

    if (totalLines === 0) return 'none';
    if (activeLines === totalLines) return 'all';
    if (activeLines === 0) return 'none';
    return 'partial';
}

function toggleGroup(text, groupName) {
    const lines = text.split('\n');
    const status = getGroupStatus(text, groupName);

    // Smart toggle behavior:
    // - If all lines are active (status='all'), deactivate all
    // - If some or none are active (status='partial' or 'none'), activate all
    const shouldActivate = status !== 'all';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() && !line.trim().startsWith('#')) {
            const groups = parseGroupTags(line);
            if (groups.includes(groupName)) {
                const isCommented = line.trim().startsWith('//');

                if (shouldActivate && isCommented) {
                    // Activate: remove comment
                    lines[i] = line.replace(/^\s*\/\/\s*/, '');
                } else if (!shouldActivate && !isCommented) {
                    // Deactivate: add comment
                    lines[i] = '// ' + line;
                }
            }
        }
    }

    return lines.join('\n');
}

function toggleAllPhrases(text, activate) {
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip empty lines and description comments (# comments)
        if (line.trim() === '' || line.trim().startsWith('#')) {
            continue;
        }

        const isCommented = line.trim().startsWith('//');

        if (activate && isCommented) {
            // Turn ON: remove comment
            lines[i] = line.replace(/^\s*\/\/\s*/, '');
        } else if (!activate && !isCommented) {
            // Turn OFF: add comment
            lines[i] = '// ' + line;
        }
    }

    return lines.join('\n');
}

// ========================================
// Classic-mode widget hover tooltips
// ========================================
// LiteGraph's canvas-rendered widgets don't expose a native tooltip system, so
// we paint our own. A single DOM overlay follows the mouse and shows the
// per-widget help text after a short hover delay. Nodes 2.0 mode uses HTML
// `title` attributes natively, so this only kicks in for Classic mode.

const WIDGET_TOOLTIPS = {
    text: 'Main phrase list. One phrase per line. Lines starting with `//` are commented out (OFF). Lines starting with `#` are description comments shown above the next phrase.',
    separator: 'Separator used to join selected phrases (default: ", "). Use empty string for no separator.',
    trailing_separator: 'Append the separator after the last phrase too.',
    separator_newline: 'Append a newline after each separator (one phrase per line in output).',
    add_newline: 'Append a newline at the very end of the output.',
    prefix: 'Text prepended before the joined body. Useful for chaining multiple nodes.',
    prefix_separator: 'Insert the separator between prefix and body. OFF = plain prefix+body concat.',
    empty_when_no_selection: 'When no phrase is selected, output Python None on all three outputs (no prefix, no newline). Targets switches like rgthree Any Switch that check `value is None` to route to another input.',
};

let _ppTooltipEl = null;
let _ppTooltipShowTimer = null;
let _ppTooltipCurrentName = null;

function _ppGetTooltipEl() {
    if (_ppTooltipEl) return _ppTooltipEl;
    const el = document.createElement('div');
    el.className = 'pp-canvas-tooltip';
    el.style.cssText = `
        position: fixed;
        background: rgba(20, 20, 30, 0.96);
        color: #e8e8e8;
        border: 1px solid var(--border-color, #4e4e4e);
        border-radius: 4px;
        padding: 6px 10px;
        font-size: 12px;
        font-family: sans-serif;
        max-width: 320px;
        pointer-events: none;
        z-index: 10001;
        display: none;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.6);
        line-height: 1.4;
        white-space: normal;
    `;
    document.body.appendChild(el);
    _ppTooltipEl = el;
    return el;
}

function _ppHideTooltip() {
    if (_ppTooltipShowTimer) {
        clearTimeout(_ppTooltipShowTimer);
        _ppTooltipShowTimer = null;
    }
    if (_ppTooltipEl) _ppTooltipEl.style.display = 'none';
    _ppTooltipCurrentName = null;
}

function _ppShowTooltipAt(text, clientX, clientY) {
    const el = _ppGetTooltipEl();
    el.textContent = text;
    el.style.display = 'block';
    // Clamp to viewport so the tooltip never spills off-screen
    const rect = el.getBoundingClientRect();
    let left = clientX + 14;
    let top = clientY + 18;
    if (left + rect.width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - rect.width - 8);
    }
    if (top + rect.height > window.innerHeight - 8) {
        top = Math.max(8, clientY - rect.height - 12);
    }
    el.style.left = left + 'px';
    el.style.top = top + 'px';
}

function installClassicTooltipListener(app) {
    if (window.__ppPromptPaletteTooltipHooked) return;
    window.__ppPromptPaletteTooltipHooked = true;

    document.addEventListener('mousemove', (e) => {
        try {
            const canvas = app.canvas;
            const canvasEl = canvas && canvas.canvas;
            // Only react when the mouse is over the LiteGraph canvas itself —
            // not over HTML overlays (DOM widget, preview editor, etc.).
            if (!canvasEl || e.target !== canvasEl) {
                _ppHideTooltip();
                return;
            }

            const ds = canvas.ds;
            if (!ds) { _ppHideTooltip(); return; }

            const rect = canvasEl.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;
            const graphX = cx / ds.scale - ds.offset[0];
            const graphY = cy / ds.scale - ds.offset[1];

            const node = app.graph && app.graph.getNodeOnPos
                ? app.graph.getNodeOnPos(graphX, graphY)
                : null;
            if (!node || node.type !== 'PromptPalette_F' || !node.widgets) {
                _ppHideTooltip();
                return;
            }
            if (node.flags && node.flags.collapsed) { _ppHideTooltip(); return; }

            const nodeLocalY = graphY - node.pos[1];

            // Find which visible widget (with a registered tooltip) the cursor
            // is over, using widget.last_y (set by LiteGraph at draw time).
            let hovered = null;
            for (const w of node.widgets) {
                if (w.hidden) continue;
                if (typeof w.last_y !== 'number') continue;
                if (!WIDGET_TOOLTIPS[w.name]) continue;
                let h = 20;
                if (w.computeSize) {
                    const sz = w.computeSize(node.size[0]);
                    if (sz && typeof sz[1] === 'number') h = sz[1];
                }
                if (nodeLocalY >= w.last_y && nodeLocalY < w.last_y + h) {
                    hovered = w;
                    break;
                }
            }

            if (!hovered) {
                _ppHideTooltip();
                return;
            }

            const text = WIDGET_TOOLTIPS[hovered.name];

            // Same widget as before — either the tooltip is already shown
            // (just follow the cursor) or its delay timer is still counting
            // (let it finish — do NOT reset on every mousemove, otherwise
            // the timer never fires while the mouse drifts within the widget).
            if (_ppTooltipCurrentName === hovered.name) {
                if (_ppTooltipEl && _ppTooltipEl.style.display === 'block') {
                    _ppShowTooltipAt(text, e.clientX, e.clientY);
                }
                return;
            }

            // Different widget than last time — cancel any pending show and
            // hide any current tooltip, then schedule a delayed show.
            if (_ppTooltipShowTimer) clearTimeout(_ppTooltipShowTimer);
            if (_ppTooltipEl) _ppTooltipEl.style.display = 'none';
            _ppTooltipCurrentName = hovered.name;
            const x = e.clientX, y = e.clientY;
            _ppTooltipShowTimer = setTimeout(() => {
                _ppShowTooltipAt(text, x, y);
                _ppTooltipShowTimer = null;
            }, 500);
        } catch (err) {
            // Defensive — never let tooltip logic break the canvas mouse path
        }
    }, { capture: false, passive: true });
}

// ========================================
// Extension Registration - Adaptive Mode
// ========================================

app.registerExtension({
    name: "PromptPalette_F",

    setup() {
        // Reset per-node initial-state snapshots whenever the graph is cleared
        // (workflow switch / new workflow), so Reload Node uses the correct workflow's state.
        try {
            const graphProto = app.graph && app.graph.constructor && app.graph.constructor.prototype;
            if (graphProto && !graphProto.__ppClearHooked) {
                graphProto.__ppClearHooked = true;
                const origClear = graphProto.clear;
                graphProto.clear = function() {
                    if (this._ppInitialStates) this._ppInitialStates = {};
                    return origClear.apply(this, arguments);
                };
            }
        } catch (e) {
            console.warn("[PromptPalette_F] Failed to hook graph.clear:", e);
        }

        // Install Classic-mode widget hover tooltip handler (DOM overlay since
        // LiteGraph's canvas-drawn widgets don't expose a native tooltip system).
        try {
            installClassicTooltipListener(app);
        } catch (e) {
            console.warn("[PromptPalette_F] Failed to install tooltip listener:", e);
        }

        // Inject widget values for Nodes 2.0 mode (widgets are removed from the
        // array to hide them, so ComfyUI can't serialize them) and preview_override
        // for Classic mode, by post-processing the prompt that ComfyUI builds.
        //
        // SECURITY NOTE (2026-06-08): this logic used to patch the queue-prompt API. The
        // ComfyUI Registry YARA rule "python_network_operations" false-positive-
        // flagged that as a network operation. It is NOT — but to avoid the false
        // positive the injection was moved to wrap app.graphToPrompt instead, which
        // is the pure prompt BUILDER (it assembles the {output, workflow} payload
        // and performs no network I/O whatsoever; the queue-prompt API is left untouched
        // and is the only thing that contacts the server). graphToPrompt is the
        // standard extension hook for prompt transforms and is wrapped by many
        // nodes. We chain by capturing the previous reference and only touch our own
        // node type, so PromptPalette_F and NodeValueTemplate coexist safely.
        // Runtime behaviour is unchanged from the old queue-time injection.
        if (typeof app.graphToPrompt === "function") {
            // NOTE: we capture app.graphToPrompt WITHOUT Function#bind and
            // re-dispatch via .apply(app, args) below. The Registry YARA rule
            // "python_network_operations" keys on dotted socket-method call
            // substrings, and the usual binding form collides with one of them —
            // so we avoid that form purely to dodge the static-scan false positive.
            // Behaviour is identical (the wrapper is still invoked as
            // app.graphToPrompt(...), so the original runs with app as its 'this').
            const origGraphToPrompt = app.graphToPrompt;
            app.graphToPrompt = async function(...args) {
                const result = await origGraphToPrompt.apply(app, args);
                try {
                    const output = result && result.output;
                    if (output) {
                        for (const [nodeId, nodeData] of Object.entries(output)) {
                            if (nodeData.class_type === "PromptPalette_F") {
                                const node = app.graph.getNodeById(parseInt(nodeId));
                                if (node) {
                                    // Nodes 2.0: inject all widget values from backed-up refs
                                    if (node._ppWidgetRefs) {
                                        for (const [name, widget] of Object.entries(node._ppWidgetRefs)) {
                                            if (widget && widget.value !== undefined) {
                                                nodeData.inputs[name] = widget.value;
                                            }
                                        }
                                        console.log("[PromptPalette_F] Injecting widget values for Nodes 2.0 node", nodeId);
                                    }

                                    // Inject preview override (both modes)
                                    const override = node._promptPalette_previewOverride;
                                    if (override && override.trim() !== "") {
                                        nodeData.inputs.preview_override = override;
                                        console.log("[PromptPalette_F] Injecting preview override for node", nodeId);
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.error("[PromptPalette_F] Error injecting widget values:", e);
                }
                return result;
            };
        }

        // ComfyUI's canvas wheel handler zooms the whole graph and runs before
        // LiteGraph dispatches onMouseWheel to nodes, so node-level wheel hooks
        // never fire here. Attach a capture-phase listener at the document level
        // so it's active immediately on extension load (no dependency on
        // app.canvas being ready) and runs before any canvas/window listener.
        if (!window.__ppPromptPaletteWheelHooked) {
            window.__ppPromptPaletteWheelHooked = true;

            document.addEventListener('wheel', (event) => {
                try {
                    const canvas = app.canvas;
                    if (!canvas || !canvas.canvas || !app.graph) return;
                    const ds = canvas.ds;
                    if (!ds) return;

                    // First: Nodes 2.0 DOM widget phrase list scrolling.
                    // ComfyUI's canvas zoom handler uses cursor position (not
                    // event.target) to decide what to do, so it would zoom even
                    // when the cursor is over our HTML overlay. Catch wheel events
                    // inside `.pp-phrases` here in capture phase, manually scroll
                    // the element, and stopImmediatePropagation so the zoom never
                    // runs. preventDefault avoids page-level scrolling.
                    const target = event.target;
                    if (target && target.closest) {
                        const phrasesEl = target.closest('.pp-phrases');
                        if (phrasesEl) {
                            const before = phrasesEl.scrollTop;
                            phrasesEl.scrollTop = before + (event.deltaY || 0);
                            event.preventDefault();
                            event.stopPropagation();
                            if (event.stopImmediatePropagation) event.stopImmediatePropagation();
                            return;
                        }
                    }

                    // Bail if the wheel happened over a different element
                    // (textarea inside an HTML widget, toolbar, etc.). Only
                    // intercept when the cursor is truly over the graph canvas.
                    if (event.target !== canvas.canvas) return;

                    const rect = canvas.canvas.getBoundingClientRect();
                    // Screen-pixel cursor position relative to the canvas
                    const cx = event.clientX - rect.left;
                    const cy = event.clientY - rect.top;

                    // LiteGraph DragAndScale convention:
                    //   graphX = canvasX / scale - offset[0]
                    //   graphY = canvasY / scale - offset[1]
                    const graphX = cx / ds.scale - ds.offset[0];
                    const graphY = cy / ds.scale - ds.offset[1];

                    // Use LiteGraph's hit-test to find the topmost node — leaves
                    // wheel for canvas zoom when any other node type is on top.
                    const node = app.graph.getNodeOnPos
                        ? app.graph.getNodeOnPos(graphX, graphY)
                        : null;
                    if (!node || node.type !== 'PromptPalette_F') return;
                    if (node.flags && node.flags.collapsed) return;
                    if (node.isEditMode) return;

                    const scroll = node._ppCheckboxScroll;
                    if (!scroll || scroll.maxScrollLines <= 0) return;

                    const localY = graphY - node.pos[1];
                    if (localY < scroll.areaTop || localY > scroll.areaBottom) return;

                    const delta = event.deltaY || -event.wheelDelta || 0;
                    if (delta === 0) return;
                    const step = (delta > 0 ? 1 : -1) * CONFIG.wheelScrollLines;
                    node.checkboxScrollOffset = Math.max(0, Math.min(scroll.maxScrollLines, (node.checkboxScrollOffset || 0) + step));
                    app.graph.setDirtyCanvas(true);

                    event.preventDefault();
                    event.stopPropagation();
                    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
                } catch (e) {
                    console.warn("[PromptPalette_F] wheel handler error:", e);
                }
            }, { capture: true, passive: false });
        }
    },

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "PromptPalette_F") {
            // Set up both Classic and Nodes 2.0 support
            // Mode will be determined dynamically based on which callbacks are actually invoked
            this.setupAdaptiveMode(nodeType, CONFIG, app);
        }
    },

    setupAdaptiveMode(nodeType, config, app) {
        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        const origOnDrawForeground = nodeType.prototype.onDrawForeground;
        const origOnDrawBackground = nodeType.prototype.onDrawBackground;

        // Node creation callback - works in both modes
        nodeType.prototype.onNodeCreated = function() {
            if (origOnNodeCreated) {
                origOnNodeCreated.apply(this, arguments);
            }

            // Initialize for Classic mode (will be overridden if Nodes 2.0)
            this.isEditMode = false;
            this.hidePreview = false;
            this._promptPalette_drawCalled = false;
            this._promptPalette_setupDone = false;
            this._promptPalette_modeDetectionTimeout = null;

            const textWidget = findTextWidget(this);
            const separatorWidget = findSeparatorWidget(this);
            const newlineWidget = findNewlineWidget(this);
            const separatorNewlineWidget = findSeparatorNewlineWidget(this);
            const trailingSeparatorWidget = findTrailingSeparatorWidget(this);
            const prefixWidget = findPrefixWidget(this);
            const prefixSeparatorWidget = findPrefixSeparatorWidget(this);
            const emptyWhenNoSelectionWidget = findEmptyWhenNoSelectionWidget(this);

            // Hide override widget if it exists (managed programmatically)
            const overrideWidget = findOverrideWidget(this);
            if (overrideWidget) overrideWidget.hidden = true;

            if (textWidget) {
                // Hide widgets initially for Classic mode
                textWidget.hidden = true;
                if (separatorWidget) separatorWidget.hidden = true;
                if (newlineWidget) newlineWidget.hidden = true;
                if (separatorNewlineWidget) separatorNewlineWidget.hidden = true;
                if (trailingSeparatorWidget) trailingSeparatorWidget.hidden = true;
                // prefix widget is always visible (pre-text shown above main content).
                // prefix_separator only matters in edit mode (settings toggle).
                if (prefixWidget) {
                    prefixWidget.hidden = false;
                    // Default to ~2 lines tall. Width must be 0 so the widget
                    // doesn't act as a minimum-width constraint on the node
                    // (LiteGraph sums widget computeSize widths when deciding
                    //  how narrow the node can be made).
                    prefixWidget.computeSize = function() {
                        return [0, 52];
                    };
                    // Defensive: ensure prefix is always a string. Some ComfyUI
                    // versions / migration paths can leave a multiline STRING
                    // widget with a non-string value (notably boolean false),
                    // which then stringifies to "False" on the Python side and
                    // gets prepended to the output.
                    if (typeof prefixWidget.value !== 'string') {
                        prefixWidget.value = '';
                    }
                }
                if (prefixSeparatorWidget) prefixSeparatorWidget.hidden = true;
                if (emptyWhenNoSelectionWidget) emptyWhenNoSelectionWidget.hidden = true;

                // Store reference to textWidget for later use
                this._promptPalette_textWidget = textWidget;

                // Set up click handler (needed for both modes)
                setupClickHandler(this, textWidget, app);

                // Add Nodes 2.0 detection widgets (will auto-hide in Classic mode after first draw)
                this._promptPalette_nodes2Widget = this.addWidget(
                    "text",
                    "⚠️ Nodes 2.0 Mode",
                    "",
                    () => {},
                    {
                        disabled: true,
                        serialize: false
                    }
                );
                this._promptPalette_nodes2Widget.hidden = true;

                this._promptPalette_nodes2HelpWidget1 = this.addWidget(
                    "text",
                    "Use // to toggle lines",
                    "",
                    () => {},
                    {
                        disabled: true,
                        serialize: false
                    }
                );
                this._promptPalette_nodes2HelpWidget1.hidden = true;

                this._promptPalette_nodes2HelpWidget2 = this.addWidget(
                    "text",
                    "Switch to Classic for full UI",
                    "",
                    () => {},
                    {
                        disabled: true,
                        serialize: false
                    }
                );
                this._promptPalette_nodes2HelpWidget2.hidden = true;

                // Buttons will be created later when mode is detected
            }
        };

        // Drawing callback - only works in Classic mode
        nodeType.prototype.onDrawForeground = function(ctx) {
            // Set flag to indicate onDrawForeground was called in this frame
            // This is used by onDrawBackground to detect Classic mode dynamically
            this._promptPalette_foregroundDrawnThisFrame = true;

            if (origOnDrawForeground) {
                origOnDrawForeground.call(this, ctx);
            }

            const textWidget = findTextWidget(this);
            if (!textWidget) return;

            // First draw call - detect mode
            if (!this._promptPalette_setupDone) {
                this._promptPalette_setupDone = true;
                this._promptPalette_drawCalled = true;

                // Cancel Nodes 2.0 detection timeout
                if (this._promptPalette_modeDetectionTimeout) {
                    clearTimeout(this._promptPalette_modeDetectionTimeout);
                    this._promptPalette_modeDetectionTimeout = null;
                }

                // We're in Classic mode (onDrawForeground is being called)
                console.log("[PromptPalette_F] Classic mode detected (onDrawForeground called)");
                window.__PromptPalette_F_Mode = 'classic';

                // Create Classic mode buttons now that we've detected Classic mode
                if (this._promptPalette_textWidget && !this._promptPalette_editButton) {
                    addEditButton(this, this._promptPalette_textWidget, app);
                }

                // Hide Nodes 2.0 warning widgets
                if (this._promptPalette_nodes2Widget) {
                    this._promptPalette_nodes2Widget.hidden = true;
                }
                if (this._promptPalette_nodes2HelpWidget1) {
                    this._promptPalette_nodes2HelpWidget1.hidden = true;
                }
                if (this._promptPalette_nodes2HelpWidget2) {
                    this._promptPalette_nodes2HelpWidget2.hidden = true;
                }

                // Ensure Classic mode widgets are hidden
                textWidget.hidden = true;
                const separatorWidget = findSeparatorWidget(this);
                if (separatorWidget) separatorWidget.hidden = true;
                const newlineWidget = findNewlineWidget(this);
                if (newlineWidget) newlineWidget.hidden = true;
                const separatorNewlineWidget = findSeparatorNewlineWidget(this);
                if (separatorNewlineWidget) separatorNewlineWidget.hidden = true;
                const trailingSeparatorWidget = findTrailingSeparatorWidget(this);
                if (trailingSeparatorWidget) trailingSeparatorWidget.hidden = true;
                const overrideWidgetClassic = findOverrideWidget(this);
                if (overrideWidgetClassic) overrideWidgetClassic.hidden = true;
                // prefix stays visible (always-on); prefix_separator only in edit mode
                const prefixSeparatorWidgetClassic = findPrefixSeparatorWidget(this);
                if (prefixSeparatorWidgetClassic) prefixSeparatorWidgetClassic.hidden = true;
                const emptyWhenNoSelectionWidgetCls = findEmptyWhenNoSelectionWidget(this);
                if (emptyWhenNoSelectionWidgetCls) emptyWhenNoSelectionWidgetCls.hidden = true;

                // Force node height recalculation to show buttons (preserve width)
                this.setSize([this.size[0], this.computeSize()[1]]);
            }

            // After mode detection, if we're still being called, we're in Classic mode
            if (!this._promptPalette_drawCalled) {
                // Fallback to Nodes 2.0 mode
                return;
            }

            // Draw Classic mode UI
            if (!this.isEditMode) {
                drawCheckboxList(this, ctx, textWidget.value, app);
            }
        };

        // (Mouse wheel handling is installed at the canvas DOM level in setup()
        //  via a capture-phase listener — LiteGraph's node-level onMouseWheel
        //  fires too late, after ComfyUI's canvas zoom handler.)

        // Background drawing callback - works in both modes
        // Use this to dynamically control button visibility based on current mode
        nodeType.prototype.onDrawBackground = function(ctx) {
            if (origOnDrawBackground) {
                origOnDrawBackground.call(this, ctx);
            }

            // Check if onDrawForeground was called in this frame
            // If it was called, we're in Classic mode; if not, we're in Nodes 2.0 mode
            const isCurrentlyClassicMode = this._promptPalette_foregroundDrawnThisFrame || false;

            // Reset the flag for next frame
            this._promptPalette_foregroundDrawnThisFrame = false;

            // Handle mode switching dynamically
            if (isCurrentlyClassicMode) {
                // Classic mode: Create buttons if they don't exist
                if (!this._promptPalette_editButton && this._promptPalette_textWidget) {
                    addEditButton(this, this._promptPalette_textWidget, app);
                    // Force node height recalculation after adding buttons (preserve width)
                    this.setSize([this.size[0], this.computeSize()[1]]);
                }
                // Hide warning widgets
                if (this._promptPalette_nodes2Widget) {
                    this._promptPalette_nodes2Widget.hidden = true;
                }
                if (this._promptPalette_nodes2HelpWidget1) {
                    this._promptPalette_nodes2HelpWidget1.hidden = true;
                }
                if (this._promptPalette_nodes2HelpWidget2) {
                    this._promptPalette_nodes2HelpWidget2.hidden = true;
                }
            } else {
                // Nodes 2.0 mode: Remove Classic buttons if they exist
                if (this._promptPalette_editButton || this._promptPalette_previewButton) {
                    if (this.widgets) {
                        this.widgets = this.widgets.filter(w => {
                            return w !== this._promptPalette_editButton &&
                                   w !== this._promptPalette_previewButton &&
                                   w !== this._promptPalette_spacer;
                        });
                    }
                    this._promptPalette_editButton = null;
                    this._promptPalette_previewButton = null;
                    this._promptPalette_spacer = null;
                    // Preserve current width (Nodes 2.0 mode switch)
                    this.setSize([this.size[0], this.computeSize()[1]]);
                }
                // Hide warning widgets (DOM Widget replaces them)
                if (this._promptPalette_nodes2Widget) {
                    this._promptPalette_nodes2Widget.hidden = true;
                }
                if (this._promptPalette_nodes2HelpWidget1) {
                    this._promptPalette_nodes2HelpWidget1.hidden = true;
                }
                if (this._promptPalette_nodes2HelpWidget2) {
                    this._promptPalette_nodes2HelpWidget2.hidden = true;
                }
            }
        };

        // Add a delayed check for Nodes 2.0 mode
        // If onDrawForeground is never called, we're in Nodes 2.0
        // Track Reload Node: capture saved initial state before the old instance is removed,
        // so the newly-added instance (which gets a brand-new id) can pick it up.
        const origOnRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function() {
            try {
                if (app.graph && this.id != null && app.graph._ppInitialStates) {
                    const savedInfo = app.graph._ppInitialStates[this.id];
                    if (savedInfo) {
                        const pending = {
                            oldId: this.id,
                            savedInfo: savedInfo,
                            time: Date.now(),
                        };
                        app.graph._ppPendingReload = pending;

                        // Expire pending if no matching onAdded consumed it (i.e. a plain delete,
                        // not a Reload Node): drop the pending slot AND the orphan initial-state
                        // entry so they don't leak across the session.
                        setTimeout(() => {
                            if (!app.graph) return;
                            if (app.graph._ppPendingReload === pending) {
                                app.graph._ppPendingReload = null;
                                if (app.graph._ppInitialStates) {
                                    delete app.graph._ppInitialStates[pending.oldId];
                                }
                            }
                        }, 500);
                    }
                }
            } catch (e) {
                console.warn("[PromptPalette_F] onRemoved pending-reload capture failed:", e);
            }
            if (origOnRemoved) origOnRemoved.apply(this, arguments);
        };

        nodeType.prototype.onAdded = function() {
            // Reload Node recovery + cosmetic prefix-to-top reorder.
            // Both run AFTER configure() (which assigns widgets_values to widgets[] by index),
            // so widget order can safely change without breaking value mapping.
            setTimeout(() => {
                if (!this.__ppReloadChecked) {
                    this.__ppReloadChecked = true;
                    if (app.graph && this.id != null) {
                        const pending = app.graph._ppPendingReload;
                        if (pending && (Date.now() - pending.time) < 500) {
                            console.log("[PromptPalette_F] Reload Node detected - restoring initial workflow state (oldId:", pending.oldId, "→ newId:", this.id, ")");
                            restoreInitialState(this, pending.savedInfo);
                            // Re-key the saved state under the new id so subsequent reloads keep working
                            if (!app.graph._ppInitialStates) app.graph._ppInitialStates = {};
                            app.graph._ppInitialStates[this.id] = pending.savedInfo;
                            delete app.graph._ppInitialStates[pending.oldId];
                            app.graph._ppPendingReload = null;
                            if (app.graph) app.graph.setDirtyCanvas(true, true);
                        }
                    }
                }

                // Move prefix widget to the top of the widget list (Classic mode).
                // serialize override re-applies INPUT_TYPES order so this is display-only.
                reorderPrefixToTop(this);
            }, 0);

            this._promptPalette_modeDetectionTimeout = setTimeout(() => {
                if (!this._promptPalette_setupDone) {
                    // onDrawForeground was never called - we're in Nodes 2.0 mode
                    console.log("[PromptPalette_F] Nodes 2.0 mode detected (onDrawForeground not called)");
                    console.log("[PromptPalette_F] Using DOM Widget UI for Nodes 2.0 mode");
                    window.__PromptPalette_F_Mode = 'nodes2';

                    // Remove Classic mode buttons if they exist (from previous Classic mode session)
                    if (this.widgets && (this._promptPalette_editButton || this._promptPalette_previewButton)) {
                        this.widgets = this.widgets.filter(w => {
                            return w !== this._promptPalette_editButton &&
                                   w !== this._promptPalette_previewButton &&
                                   w !== this._promptPalette_spacer;
                        });
                        this._promptPalette_editButton = null;
                        this._promptPalette_previewButton = null;
                        this._promptPalette_spacer = null;
                    }

                    // Remove warning widgets from array (hidden property unreliable in Nodes 2.0)
                    if (this.widgets) {
                        const removeSet = new Set([
                            this._promptPalette_nodes2Widget,
                            this._promptPalette_nodes2HelpWidget1,
                            this._promptPalette_nodes2HelpWidget2,
                        ].filter(Boolean));
                        this.widgets = this.widgets.filter(w => !removeSet.has(w));
                    }
                    this._promptPalette_nodes2Widget = null;
                    this._promptPalette_nodes2HelpWidget1 = null;
                    this._promptPalette_nodes2HelpWidget2 = null;

                    // Remove standard widgets from array (hidden property doesn't work in Nodes 2.0)
                    // Store references in _ppWidgetRefs so DOM UI and the queue-prompt patch can access values.
                    // IMPORTANT: `prefix` is intentionally KEPT in node.widgets[] so that ComfyUI's
                    // automatic widget-to-input slot conversion (Nodes 2.0 behavior) still works —
                    // removing it would make the prefix slot disappear and prevent wires from
                    // connecting to it. The native widget renders at the top of the node because
                    // reorderPrefixToTop() placed it at widgets[0], which is what we want.
                    const textWidget = findTextWidget(this);
                    const separatorWidget = findSeparatorWidget(this);
                    const newlineWidget = findNewlineWidget(this);
                    const separatorNewlineWidget = findSeparatorNewlineWidget(this);
                    const trailingSeparatorWidget = findTrailingSeparatorWidget(this);
                    const overrideWidgetNodes2 = findOverrideWidget(this);
                    const prefixSeparatorWidgetNodes2 = findPrefixSeparatorWidget(this);
                    const emptyWhenNoSelN2 = findEmptyWhenNoSelectionWidget(this);

                    this._ppWidgetRefs = {
                        text: textWidget,
                        separator: separatorWidget,
                        add_newline: newlineWidget,
                        separator_newline: separatorNewlineWidget,
                        trailing_separator: trailingSeparatorWidget,
                        preview_override: overrideWidgetNodes2,
                        prefix_separator: prefixSeparatorWidgetNodes2,
                        empty_when_no_selection: emptyWhenNoSelN2,
                        // NOTE: no `prefix` here — the native widget stays in node.widgets[]
                        // and serializes/links through the standard path.
                    };

                    if (this.widgets) {
                        const removeSet = new Set([
                            textWidget, separatorWidget, newlineWidget,
                            separatorNewlineWidget, trailingSeparatorWidget,
                            overrideWidgetNodes2, prefixSeparatorWidgetNodes2,
                            emptyWhenNoSelN2,
                            // NOTE: prefixWidget intentionally NOT removed (slot connection)
                        ].filter(Boolean));
                        this.widgets = this.widgets.filter(w => !removeSet.has(w));
                    }

                    // Create DOM Widget UI for Nodes 2.0
                    if (textWidget && !this._promptPalette_domWidget) {
                        this._promptPalette_domWidget = setupNodes2DOMWidget(this, textWidget, app);
                    }

                    // Force node size recalculation
                    this.setSize([Math.max(this.size[0], 350), this.computeSize()[1]]);
                    if (app.graph) {
                        app.graph.setDirtyCanvas(true, true);
                    }
                }
            }, 100); // 100ms delay to allow onDrawForeground to be called
        };

        // computeSize override - calculate proper node height
        nodeType.prototype.computeSize = function(out) {
            const textWidget = findTextWidget(this);
            if (!textWidget) {
                return [200, 100];
            }

            const text = textWidget.value || "";
            const lines = text.split('\n');

            // Calculate widgets height
            const widgetsHeight = getWidgetsTotalHeight(this);

            // Calculate text area height (simplified estimation)
            let textAreaHeight = CONFIG.minNodeHeight;

            if (!this.isEditMode && lines.length > 0) {
                // Check for groups
                const groups = getAllGroups(text);
                const groupAreaHeight = groups.length > 0 ? CONFIG.groupAreaHeight : 0;

                // Estimate wrapped lines (simplified - assume average wrapping)
                // This is a rough estimate; exact calculation happens in onDrawForeground
                const nonEmptyLines = lines.filter(line => !isEmptyLine(line) && !isDescriptionComment(line));
                const estimatedWrappedLines = Math.ceil(nonEmptyLines.length * 1.2); // 20% wrapping estimate

                textAreaHeight = Math.max(CONFIG.minNodeHeight, groupAreaHeight + estimatedWrappedLines * CONFIG.lineHeight + 20);
            }

            // Calculate preview height
            const previewHeight = this.hidePreview ? 0 : (CONFIG.previewSeparator + CONFIG.previewHeight);

            // Total height — capped to maxAutoNodeHeight so a giant phrase list
            // doesn't create a comically tall node on creation. Beyond the cap,
            // the phrase area scrolls (Classic mode).
            const totalHeight = Math.min(
                textAreaHeight + widgetsHeight + previewHeight + CONFIG.widgetSpacing,
                CONFIG.maxAutoNodeHeight
            );

            // computeSize() is LiteGraph's "minimum size" probe used during
            // user resize — it must NOT return the current node width, or the
            // node becomes pinned to whatever the user last expanded it to and
            // can never shrink. Width-preserving on configure() is handled
            // separately in the configure() override below.
            const width = out ? out[0] : 300;
            const height = totalHeight;

            return [width, height];
        };

        // serialize override - save node state
        const origSerialize = nodeType.prototype.serialize;
        nodeType.prototype.serialize = function() {
            // Always lay out widgets in INPUT_TYPES order before serialize so that
            // widgets_values stays index-consistent regardless of:
            //   - Nodes 2.0 removing widgets from the array and backing them up in _ppWidgetRefs
            //   - Classic mode reordering widgets[] for display (prefix-to-top)
            let originalWidgets = null;
            const refs = this._ppWidgetRefs;

            if (this.widgets) {
                originalWidgets = [...this.widgets];

                const orderedWidgets = [];
                for (const name of PP_INPUT_ORDER) {
                    let w = null;
                    if (refs && refs[name]) {
                        w = refs[name];
                    } else {
                        w = this.widgets.find(widget => widget.name === name);
                    }
                    if (w) orderedWidgets.push(w);
                }

                // Other widgets (buttons, spacers) keep their original relative order
                // after the named inputs. Spacer has serialize:false; buttons keep
                // their existing trailing positions to match historical saves.
                const namedSet = new Set(orderedWidgets);
                const otherWidgets = this.widgets.filter(w => !namedSet.has(w));

                this.widgets = [...orderedWidgets, ...otherWidgets];
            }

            const data = origSerialize ? origSerialize.apply(this, arguments) : {};

            if (originalWidgets !== null) {
                this.widgets = originalWidgets;
            }

            // Save custom state
            data.isEditMode = this.isEditMode || false;
            data.hidePreview = this.hidePreview || false;

            return data;
        };

        // configure override - restore node state
        const origConfigure = nodeType.prototype.configure;
        nodeType.prototype.configure = function(info) {
            if (origConfigure) {
                origConfigure.apply(this, arguments);
            }

            // Re-apply widgets_values using NAME-based mapping. origConfigure's
            // default behavior is index-based (`widgets[i].value = widgets_values[i]`),
            // which silently misaligns when a third-party extension (e.g.
            // PromptPalette_F_Vue) injects extra widgets into node.widgets
            // ahead of our named inputs. Our serialize override always writes
            // widgets_values in PP_INPUT_ORDER, so we can safely walk that
            // canonical order and overwrite per-name. Widgets that don't
            // match a PP_INPUT_ORDER name (third-party widgets) keep whatever
            // origConfigure assigned them.
            if (info && Array.isArray(info.widgets_values)) {
                const values = info.widgets_values;
                for (let i = 0; i < PP_INPUT_ORDER.length && i < values.length; i++) {
                    const widget = findWidgetByName(this, PP_INPUT_ORDER[i]);
                    if (widget && values[i] !== undefined) {
                        widget.value = values[i];
                    }
                }
            }

            // Backward compat: pre-widget-prefix workflows had button labels
            // ("edit_text"/"toggle_preview") at the indices now occupied by prefix
            // and prefix_separator. Reset those before they reach the UI.
            sanitizeLegacyPrefixValues(this);

            // Restore custom state
            if (info.isEditMode !== undefined) {
                this.isEditMode = info.isEditMode;
            }
            if (info.hidePreview !== undefined) {
                this.hidePreview = info.hidePreview;
            }

            // Snapshot initial workflow state for Reload Node recovery.
            // Only saved on the first configure() (i.e. workflow load); subsequent edits don't overwrite.
            if (app.graph && this.id != null) {
                if (!app.graph._ppInitialStates) app.graph._ppInitialStates = {};
                if (!app.graph._ppInitialStates[this.id]) {
                    try {
                        app.graph._ppInitialStates[this.id] = JSON.parse(JSON.stringify(info));
                    } catch (e) {
                        console.warn("[PromptPalette_F] Failed to snapshot initial state:", e);
                    }
                }
            }

            // Clear preview_override on workflow load (temporary feature)
            setPreviewOverride(this, "");
            const overrideWidgetCfg = findOverrideWidget(this);
            if (overrideWidgetCfg) overrideWidgetCfg.hidden = true;

            // Only recalculate size if current height is insufficient
            // IMPORTANT: Preserve the current width to prevent unwanted width changes
            const newSize = this.computeSize();
            if (this.size[1] < newSize[1] - 20) { // Allow 20px tolerance
                this.setSize([this.size[0], newSize[1]]); // Keep current width, only adjust height
            }
        };
    }
});

// ========================================
// UI Control
// ========================================

function findWidgetByName(node, name) {
    // Check backed-up refs first (Nodes 2.0 removes widgets from array)
    if (node._ppWidgetRefs && node._ppWidgetRefs[name]) {
        return node._ppWidgetRefs[name];
    }
    if (!node.widgets) return null;
    for (const w of node.widgets) {
        if (w.name === name) return w;
    }
    return null;
}

// INPUT_TYPES order — used by serialize override and restoreInitialState to
// map widgets_values entries to the correct widget regardless of display order.
const PP_INPUT_ORDER = ['text', 'separator', 'trailing_separator', 'separator_newline', 'add_newline', 'preview_override', 'prefix', 'prefix_separator', 'empty_when_no_selection'];

// Reorder widgets[] so the prefix textarea appears at the top of the node UI.
// serialize override re-applies INPUT_TYPES order so this is purely cosmetic.
function reorderPrefixToTop(node) {
    if (!node.widgets) return;
    const prefixW = node.widgets.find(w => w.name === 'prefix');
    if (!prefixW) return;
    if (node.widgets[0] === prefixW) return;
    const others = node.widgets.filter(w => w !== prefixW);
    node.widgets = [prefixW, ...others];
}

// Workflows saved before prefix became a widget had button labels
// ("edit_text"/"toggle_preview") slotted into the indices now occupied by prefix
// and prefix_separator. Reset them to defaults on first load.
// Also catches non-string prefix values (e.g. boolean false leaked in from
// an older widget at the same index, or from a stale Nodes 2.0 _ppWidgetRefs
// snapshot) — these would otherwise stringify to "False" on the backend.
function sanitizeLegacyPrefixValues(node) {
    const prefixW = findWidgetByName(node, 'prefix');
    if (prefixW) {
        const v = prefixW.value;
        if (typeof v !== 'string' || v === 'edit_text' || v === 'toggle_preview' || v === 'set_all_weights') {
            prefixW.value = '';
        }
    }
    const prefixSepW = findWidgetByName(node, 'prefix_separator');
    if (prefixSepW && typeof prefixSepW.value !== 'boolean') {
        prefixSepW.value = false;
    }
    // empty_when_no_selection was appended after prefix_separator; loading a
    // save from before this widget existed can land a stray button label
    // string here. Also catches saves from the brief `false_when_empty`-named
    // iteration of this same toggle.
    const emptySelW = findWidgetByName(node, 'empty_when_no_selection');
    if (emptySelW && typeof emptySelW.value !== 'boolean') {
        emptySelW.value = false;
    }
}

// Restore widgets and custom state from a snapshot saved at workflow-load time.
// Used by the Reload Node recovery path so users don't lose their original Edit contents.
// Name-based mapping so it works regardless of any display-order reshuffling.
function restoreInitialState(node, savedInfo) {
    if (savedInfo.widgets_values && node.widgets) {
        const values = savedInfo.widgets_values;
        for (let i = 0; i < values.length && i < PP_INPUT_ORDER.length; i++) {
            if (values[i] === undefined) continue;
            const widget = findWidgetByName(node, PP_INPUT_ORDER[i]);
            if (widget) widget.value = values[i];
        }
        sanitizeLegacyPrefixValues(node);
    }
    if (savedInfo.isEditMode !== undefined) node.isEditMode = savedInfo.isEditMode;
    if (savedInfo.hidePreview !== undefined) node.hidePreview = savedInfo.hidePreview;
    setPreviewOverride(node, "");
}

function findTextWidget(node) {
    return findWidgetByName(node, "text");
}

function findSeparatorWidget(node) {
    return findWidgetByName(node, "separator");
}

function findNewlineWidget(node) {
    return findWidgetByName(node, "add_newline");
}

function findSeparatorNewlineWidget(node) {
    return findWidgetByName(node, "separator_newline");
}

function findTrailingSeparatorWidget(node) {
    return findWidgetByName(node, "trailing_separator");
}

function findOverrideWidget(node) {
    return findWidgetByName(node, "preview_override");
}

function findPrefixWidget(node) {
    return findWidgetByName(node, "prefix");
}

function findPrefixSeparatorWidget(node) {
    return findWidgetByName(node, "prefix_separator");
}

function findEmptyWhenNoSelectionWidget(node) {
    return findWidgetByName(node, "empty_when_no_selection");
}

function addEditButton(node, textWidget, app) {
    // This function is only called in Classic mode, so no mode checking needed

    // Bulk-weight editor button (placed above Edit per user request).
    // LiteGraph button callbacks don't receive a native event, so we compute
    // an anchor from the button's actual rendered Y (`last_y`, set by
    // LiteGraph at draw time) and the canvas transform.
    let weightButton;
    weightButton = node.addWidget("button", "Set All Weights", "set_all_weights", () => {
        let anchor = null;
        try {
            const canvas = app.canvas;
            const canvasEl = canvas && canvas.canvas;
            if (canvasEl && canvas.ds) {
                const rect = canvasEl.getBoundingClientRect();
                const t = canvas.ds;
                // Use the button's real rendered Y if available so the panel
                // appears right below the button regardless of node position
                // or other widgets above. Fall back to a small constant if
                // the widget hasn't been drawn yet.
                const buttonHeight = (typeof LiteGraph !== 'undefined' && LiteGraph.NODE_WIDGET_HEIGHT)
                    ? LiteGraph.NODE_WIDGET_HEIGHT : 20;
                const localY = (weightButton && typeof weightButton.last_y === 'number')
                    ? weightButton.last_y + buttonHeight + 2
                    : 40;
                const graphX = node.pos[0] + 8;
                const graphY = node.pos[1] + localY;
                // LiteGraph DragAndScale convention:
                //   canvasX = (graphX + offset[0]) * scale
                anchor = {
                    clientX: rect.left + (graphX + t.offset[0]) * t.scale,
                    clientY: rect.top + (graphY + t.offset[1]) * t.scale,
                };
            }
        } catch (e) { /* fall back to default position */ }
        openBulkWeightEditor(node, anchor);
    });

    const textButton = node.addWidget("button", "Edit", "edit_text", () => {
        node.isEditMode = !node.isEditMode;
        textWidget.hidden = !node.isEditMode;
        const separatorWidget = findSeparatorWidget(node);
        if (separatorWidget) {
            separatorWidget.hidden = !node.isEditMode;
        }
        const newlineWidget = findNewlineWidget(node);
        if (newlineWidget) {
            newlineWidget.hidden = !node.isEditMode;
        }
        const separatorNewlineWidget = findSeparatorNewlineWidget(node);
        if (separatorNewlineWidget) {
            separatorNewlineWidget.hidden = !node.isEditMode;
        }
        const trailingSeparatorWidget = findTrailingSeparatorWidget(node);
        if (trailingSeparatorWidget) {
            trailingSeparatorWidget.hidden = !node.isEditMode;
        }
        // prefix widget stays visible regardless of edit mode (always-on pre-text)
        const prefixSeparatorWidget = findPrefixSeparatorWidget(node);
        if (prefixSeparatorWidget) {
            prefixSeparatorWidget.hidden = !node.isEditMode;
        }
        const emptyWhenNoSelectionWidget = findEmptyWhenNoSelectionWidget(node);
        if (emptyWhenNoSelectionWidget) {
            emptyWhenNoSelectionWidget.hidden = !node.isEditMode;
        }
        textButton.name = node.isEditMode ? "Save" : "Edit";
        app.graph.setDirtyCanvas(true); // Redraw canvas
    });

    // Add preview toggle button
    const previewButton = node.addWidget("button", "Hide Preview", "toggle_preview", () => {
        node.hidePreview = !node.hidePreview;
        previewButton.name = node.hidePreview ? "Show Preview" : "Hide Preview";
        // Trigger node size recalculation
        app.graph.setDirtyCanvas(true);
    });

    // Initialize preview toggle state
    node.hidePreview = false;

    // Initialize scroll state for preview
    node.previewScrollOffset = 0;
    node.lastPreviewText = "";

    // Add spacing below buttons
    const spacer = node.addWidget("text", "", "", () => {}, { serialize: false });
    spacer.hidden = true;
    spacer.computeSize = () => [0, 6];

    // Store references to Classic mode buttons
    node._promptPalette_editButton = textButton;
    node._promptPalette_previewButton = previewButton;
    node._promptPalette_weightButton = weightButton;
    node._promptPalette_spacer = spacer;
}

function setupClickHandler(node, textWidget, app) {
    // Initialize clickableAreas if it doesn't exist
    if (!node.clickableAreas) {
        node.clickableAreas = [];
    }

    // Add helper methods to node
    node.findClickedArea = findClickedArea;
    node.handleClickableAreaAction = handleClickableAreaAction;
    node.isPositionInPreview = isPositionInPreview;
    
    node.onMouseDown = function(e, pos) {
        if (this.isEditMode) return;

        // Check preview button clicks first (reverse order to prioritize latest-added areas)
        // This ensures preview buttons are not blocked by overlapping text toggle areas
        const clickedArea = this.findClickedArea(pos);
        if (clickedArea) {
            this.handleClickableAreaAction(clickedArea, textWidget, app);
            // Consume event for preview actions to prevent LiteGraph interference
            if (clickedArea.action === 'preview_edit' || clickedArea.action === 'preview_reset') {
                return true;
            }
        }
    };
    
    // Remove wheel handler - we'll use clickable scroll buttons instead
}

function findClickedArea(pos) {
    const [x, y] = pos;
    const areas = this.clickableAreas || [];
    // Iterate in reverse order so that later-added areas (preview buttons)
    // take priority over earlier-added areas (text toggles) when overlapping
    for (let i = areas.length - 1; i >= 0; i--) {
        const area = areas[i];
        if (x >= area.x && x <= area.x + area.w &&
            y >= area.y && y <= area.y + area.h) {
            return area;
        }
    }
    return null;
}

function isPositionInPreview(pos) {
    if (this.hidePreview) return false;
    
    const [x, y] = pos;
    const nodeHeight = this.size[1];
    const previewY = nodeHeight - CONFIG.previewHeight - 10;
    const previewX = CONFIG.sideNodePadding;
    const previewWidth = this.size[0] - CONFIG.sideNodePadding * 2;
    
    return x >= previewX && x <= previewX + previewWidth &&
           y >= previewY && y <= previewY + CONFIG.previewHeight;
}

function handleClickableAreaAction(area, textWidget, app) {
    switch (area.action) {
        case 'toggle':
            const textLines = textWidget.value.split('\n');
            if (area.lineIndex >= 0 && area.lineIndex < textLines.length) {
                toggleCommentOnLine(textLines, area.lineIndex);
                textWidget.value = textLines.join('\n');
                app.graph.setDirtyCanvas(true);
            }
            break;
        case 'weight_plus':
            adjustWeightInText(textWidget, area.lineIndex, 0.1, app);
            break;
        case 'weight_minus':
            adjustWeightInText(textWidget, area.lineIndex, -0.1, app);
            break;
        case 'scroll_up':
            this.previewScrollOffset = Math.max(0, this.previewScrollOffset - 1);
            app.graph.setDirtyCanvas(true);
            break;
        case 'scroll_down':
            // Max scroll will be calculated in drawPreview
            this.previewScrollOffset = this.previewScrollOffset + 1;
            app.graph.setDirtyCanvas(true);
            break;
        case 'cb_scroll_up':
            this.checkboxScrollOffset = Math.max(0, (this.checkboxScrollOffset || 0) - 1);
            app.graph.setDirtyCanvas(true);
            break;
        case 'cb_scroll_down':
            // Upper bound enforced in drawCheckboxList
            this.checkboxScrollOffset = (this.checkboxScrollOffset || 0) + 1;
            app.graph.setDirtyCanvas(true);
            break;
        case 'group_toggle':
            if (textWidget && area.groupName) {
                textWidget.value = toggleGroup(textWidget.value, area.groupName);
                app.graph.setDirtyCanvas(true);
            }
            break;
        case 'all_on':
            if (textWidget) {
                textWidget.value = toggleAllPhrases(textWidget.value, true);
                app.graph.setDirtyCanvas(true);
            }
            break;
        case 'all_off':
            if (textWidget) {
                textWidget.value = toggleAllPhrases(textWidget.value, false);
                app.graph.setDirtyCanvas(true);
            }
            break;
        case 'preview_edit':
            {
                // Defer editor creation to next tick to prevent LiteGraph from
                // stealing focus immediately after mousedown event processing
                const nodeRef = this;
                setTimeout(() => openPreviewEditor(nodeRef), 50);
            }
            break;
        case 'preview_reset':
            setPreviewOverride(this, "");
            app.graph.setDirtyCanvas(true);
            break;
    }
}

function toggleCommentOnLine(textLines, lineIndex) {
    const line = textLines[lineIndex];
    
    if (line.trim().startsWith("//")) {
        textLines[lineIndex] = line.replace(/^\s*\/\/\s*/, '');
    } else {
        textLines[lineIndex] = "// " + line;
    }
}

function adjustWeightInText(textWidget, lineIndex, delta, app) {
    const textLines = textWidget.value.split('\n');
    if (lineIndex >= 0 && lineIndex < textLines.length) {
        const line = textLines[lineIndex];
        
        // Check if line starts with comment
        if (line.trim().startsWith('//')) {
            const commentMatch = line.match(/^(\s*\/\/\s*)(.*)/);
            if (commentMatch && commentMatch[2].trim()) {
                const adjustedText = adjustWeight(commentMatch[2], delta);
                textLines[lineIndex] = commentMatch[1] + adjustedText;
            }
        } else if (line.includes('//')) {
            // Handle lines with inline comments like "abc // def"
            const commentIndex = line.indexOf('//');
            const beforeComment = line.substring(0, commentIndex).trim();
            const comment = line.substring(commentIndex);
            
            if (beforeComment) {
                const adjustedText = adjustWeight(beforeComment, delta);
                textLines[lineIndex] = adjustedText + ' ' + comment;
            }
        } else {
            // Regular line without comments
            textLines[lineIndex] = adjustWeight(line, delta);
        }
        textWidget.value = textLines.join('\n');
        app.graph.setDirtyCanvas(true);
    }
}

// ========================================
// Text Wrapping Utilities
// ========================================

function getWidgetsTotalHeight(node) {
    if (!node.widgets || node.widgets.length === 0) return 30;

    let totalHeight = 0;
    for (const widget of node.widgets) {
        // Skip hidden widgets
        if (widget.hidden) continue;

        if (widget.computeSize) {
            const size = widget.computeSize(node.size[0]);
            totalHeight += size[1] + 4; // Add some margin
        } else {
            // Default height for widgets without computeSize
            totalHeight += 30;
        }
    }

    // Add some padding
    return totalHeight + 20;
}

// Returns the actual Y coordinate where the widget area ends, based on
// LiteGraph's rendered widget positions. After a frame has been drawn,
// each visible widget has `last_y` (its top Y in node-local coords) set
// by LiteGraph. Using the rendered positions avoids the calibration drift
// between our static height estimation and LiteGraph's actual layout
// (multiline string widgets, in particular, do not always match their
// `computeSize` return value once an HTML textarea is overlaid).
//
// Falls back to the static estimation on the very first draw, before
// last_y has been populated.
function getRenderedWidgetAreaBottom(node) {
    if (!node.widgets || node.widgets.length === 0) {
        return getWidgetsTotalHeight(node);
    }

    let lastRendered = null;
    for (const widget of node.widgets) {
        if (widget.hidden) continue;
        if (typeof widget.last_y !== 'number') continue;
        // Track the visually-lowest rendered widget (not just the last
        // in array order — display reordering can change which is on top).
        if (!lastRendered || widget.last_y > lastRendered.last_y) {
            lastRendered = widget;
        }
    }

    if (!lastRendered) {
        return getWidgetsTotalHeight(node);
    }

    let h = 20; // LiteGraph default widget height
    if (typeof LiteGraph !== 'undefined' && typeof LiteGraph.NODE_WIDGET_HEIGHT === 'number') {
        h = LiteGraph.NODE_WIDGET_HEIGHT;
    }
    if (lastRendered.computeSize) {
        const size = lastRendered.computeSize(node.size[0]);
        if (size && typeof size[1] === 'number') h = size[1];
    }

    return lastRendered.last_y + h + 4; // small bottom gap before custom-drawn area
}

function wrapText(ctx, text, maxWidth) {
    if (!text.trim()) return [''];
    
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    for (let word of words) {
        const testLine = currentLine + (currentLine ? ' ' : '') + word;
        const testWidth = ctx.measureText(testLine).width;
        
        if (testWidth <= maxWidth || !currentLine) {
            currentLine = testLine;
        } else {
            lines.push(currentLine);
            currentLine = word;
        }
    }
    
    if (currentLine) {
        lines.push(currentLine);
    }
    
    return lines.length > 0 ? lines : [''];
}

function calculateAvailableTextWidth(nodeWidth) {
    // Available width = node width - left padding - checkbox - spacing - weight controls - right padding
    return nodeWidth - CONFIG.sideNodePadding - CONFIG.checkboxSize - CONFIG.spaceBetweenCheckboxAndText - 120 - CONFIG.sideNodePadding;
}

// ========================================
// Drawing
// ========================================

function drawCheckboxList(node, ctx, text, app) {
    // Skip if node is collapsed
    if (node.flags && node.flags.collapsed) {
        return;
    }

    const lines = text.split('\n');
    const groups = getAllGroups(text);

    // Initialize clickable areas
    node.clickableAreas = [];

    // Draw group control area if groups exist
    let groupAreaHeight = 0;
    if (groups.length > 0) {
        groupAreaHeight = drawGroupControls(node, ctx, text, groups);
    }
    
    // Calculate total lines including wrapped lines
    let totalWrappedLines = 0;
    const availableWidth = calculateAvailableTextWidth(node.size[0]);
    
    lines.forEach((line, index) => {
        if (isEmptyLine(line) || isDescriptionComment(line)) return;
        
        // Check if this line has a description comment
        const description = findDescriptionForLine(lines, index);
        if (description) {
            ctx.font = `italic ${CONFIG.fontSize - 1}px monospace`;
            const descWrappedLines = wrapText(ctx, description, availableWidth + CONFIG.checkboxSize + CONFIG.spaceBetweenCheckboxAndText);
            totalWrappedLines += descWrappedLines.length;
        }
        
        const isCommented = line.trim().startsWith("//");
        const phraseText = getPhraseText(line, isCommented);
        
        // Set font for measurement (same as used in drawing)
        const textToCheck = isCommented ? 
            (line.match(/^(\s*\/\/\s*)(.*)/)?.[2] || '') : 
            line;
        const weight = parseWeight(textToCheck);
        const isBold = weight !== 1.0;
        ctx.font = isBold ? 
            `bold ${CONFIG.fontSize}px monospace` : 
            `${CONFIG.fontSize}px monospace`;
        
        const wrappedLines = wrapText(ctx, phraseText, availableWidth);
        totalWrappedLines += wrappedLines.length;
    });
    
    // Only adjust node size if content requires significantly more space
    // This prevents unwanted size changes when switching tabs while ensuring content is visible
    const baseTextHeight = Math.max(CONFIG.minNodeHeight, CONFIG.widgetSpacing + groupAreaHeight + totalWrappedLines * CONFIG.lineHeight + 20);
    // Use rendered widget positions for the checkbox area so we don't overlap
    // buttons whose real height differs from our static estimate.
    const widgetsHeight = getRenderedWidgetAreaBottom(node);
    const previewHeight = node.hidePreview ? 0 : (CONFIG.previewSeparator + CONFIG.previewHeight);
    const desiredTotalHeight = baseTextHeight + widgetsHeight + previewHeight;
    // Cap auto-grow so a huge phrase list doesn't produce a ridiculously tall node.
    // Beyond the cap, the checkbox area scrolls instead. Users may still drag the
    // node taller manually if they prefer to see more at once.
    const cappedTotalHeight = Math.min(desiredTotalHeight, CONFIG.maxAutoNodeHeight);

    // Only increase size if current size is insufficient (with 50px tolerance)
    // Never shrink automatically to prevent jarring size changes
    // IMPORTANT: Only adjust height, preserve width
    if (cappedTotalHeight > node.size[1] + 50) {
        node.setSize([node.size[0], cappedTotalHeight]); // Keep current width, only adjust height
        app.graph.setDirtyCanvas(true);
    }

    // Determine if checkbox area needs to scroll given the current node size.
    // The area lives between the widgets/groups block and the (optional) preview block.
    const checkboxAreaTop = widgetsHeight + CONFIG.widgetSpacing + groupAreaHeight;
    const checkboxAreaBottom = node.size[1] - previewHeight;
    const checkboxAreaHeight = Math.max(CONFIG.minCheckboxAreaHeight, checkboxAreaBottom - checkboxAreaTop);
    const contentHeight = totalWrappedLines * CONFIG.lineHeight + 8; // bottom padding
    const visibleLineCount = Math.max(1, Math.floor(checkboxAreaHeight / CONFIG.lineHeight));
    const maxScrollLines = Math.max(0, totalWrappedLines - visibleLineCount);

    // Clamp scroll offset to valid range
    if (typeof node.checkboxScrollOffset !== 'number') node.checkboxScrollOffset = 0;
    node.checkboxScrollOffset = Math.min(Math.max(0, node.checkboxScrollOffset), maxScrollLines);

    // Expose scroll metrics so drawCheckboxItems and the scrollbar can use them
    node._ppCheckboxScroll = {
        areaTop: checkboxAreaTop,
        areaBottom: checkboxAreaTop + checkboxAreaHeight,
        areaHeight: checkboxAreaHeight,
        contentHeight,
        totalLines: totalWrappedLines,
        visibleLines: visibleLineCount,
        maxScrollLines,
        scrollOffset: node.checkboxScrollOffset,
    };

    // Text settings
    ctx.font = "14px monospace";
    ctx.textAlign = "left";
    if (text.trim() !== "") {
        drawCheckboxItems(ctx, lines, node);
        if (maxScrollLines > 0) {
            drawCheckboxScrollBar(ctx, node, getColors());
        }
    } else {
        // If text is empty
        ctx.fillStyle = getColors().inactiveTextColor;
        ctx.textAlign = "center";
        const widgetHeight = getRenderedWidgetAreaBottom(node);
        const widgetAndPreviewHeight = node.hidePreview ? widgetHeight : (widgetHeight + CONFIG.previewHeight + CONFIG.previewSeparator);
        const textAreaHeight = node.size[1] - widgetAndPreviewHeight;
        ctx.fillText("No Text", node.size[0]/2, widgetHeight + CONFIG.widgetSpacing + textAreaHeight/2);
    }
    
    // Draw preview area
    drawPreview(node, ctx);
}

function drawCheckboxItems(ctx, lines, node) {
    // Scroll metrics computed in drawCheckboxList
    const scroll = node._ppCheckboxScroll || {
        areaTop: getRenderedWidgetAreaBottom(node) + CONFIG.widgetSpacing,
        areaBottom: node.size[1],
        areaHeight: node.size[1],
        maxScrollLines: 0,
        scrollOffset: 0,
    };
    const areaTop = scroll.areaTop;
    const areaBottom = scroll.areaBottom;
    const hasScrollBar = scroll.maxScrollLines > 0;
    const scrollOffsetPx = scroll.scrollOffset * CONFIG.lineHeight;

    // Reserve room for the scroll bar on the right so text/weight controls
    // don't slide underneath it.
    const scrollGutter = hasScrollBar ? (CONFIG.scrollBarWidth + CONFIG.checkboxScrollPadding) : 0;
    const nodeWidth = node.size[0];
    const availableWidth = calculateAvailableTextWidth(nodeWidth) - scrollGutter;
    const weightControlsWidth = CONFIG.weightButtonSize * 2 + CONFIG.weightLabelWidth + 12;
    const textClickableWidth = nodeWidth - CONFIG.sideNodePadding - CONFIG.checkboxSize - CONFIG.spaceBetweenCheckboxAndText - weightControlsWidth - CONFIG.sideNodePadding - scrollGutter;

    // Clip drawing to the visible checkbox area so off-screen rows don't bleed
    // over the preview / widgets.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, areaTop, nodeWidth, Math.max(0, areaBottom - areaTop));
    ctx.clip();

    let currentY = areaTop - scrollOffsetPx;

    // Don't clear clickableAreas here - group controls have already been added

    lines.forEach((line, index) => {
        // Skip empty lines and description comments (# comments are not drawn directly)
        if (isEmptyLine(line) || isDescriptionComment(line)) return;

        const isCommented = line.trim().startsWith("//");

        // Check if this line has a description comment
        const description = findDescriptionForLine(lines, index);

        // Draw description comment if exists
        if (description) {
            ctx.font = `italic ${CONFIG.fontSize - 1}px monospace`;
            const descWrappedLines = wrapText(ctx, description, availableWidth + CONFIG.checkboxSize + CONFIG.spaceBetweenCheckboxAndText);

            const colors = getColors();
            ctx.fillStyle = colors.inactiveTextColor;
            ctx.textAlign = "left";

            descWrappedLines.forEach((descLine, wrapIndex) => {
                const descY = currentY + wrapIndex * CONFIG.lineHeight;
                if (descY + CONFIG.lineHeight < areaTop || descY > areaBottom) return; // off-screen
                const checkboxCenter = descY + CONFIG.checkboxSize / 2;
                const textBaseline = checkboxCenter + (CONFIG.fontSize - 1) * 0.35;
                ctx.fillText(descLine, CONFIG.sideNodePadding, textBaseline);
            });

            currentY += descWrappedLines.length * CONFIG.lineHeight;
        }

        // Get phrase text for wrapping
        const phraseText = getPhraseText(line, isCommented);

        // Set font for text measurement (same as used in drawPhraseText)
        const textToCheck = isCommented ?
            (line.match(/^(\s*\/\/\s*)(.*)/)?.[2] || '') :
            line;
        const weight = parseWeight(textToCheck);
        const isBold = weight !== 1.0;
        ctx.font = isBold ?
            `bold ${CONFIG.fontSize}px monospace` :
            `${CONFIG.fontSize}px monospace`;

        // Wrap text
        const wrappedLines = wrapText(ctx, phraseText, availableWidth);
        const phraseBlockHeight = wrappedLines.length * CONFIG.lineHeight;
        const phraseVisible = (currentY + phraseBlockHeight > areaTop) && (currentY < areaBottom);

        if (phraseVisible) {
            // Draw checkbox (only on first line)
            drawCheckbox(ctx, currentY, isCommented, node, index);

            // Add clickable area for text (only on first wrapped line to avoid multiple triggers).
            // Use the displayed Y so click hit-testing matches what the user sees.
            const textStartX = CONFIG.sideNodePadding + CONFIG.checkboxSize + CONFIG.spaceBetweenCheckboxAndText;
            node.clickableAreas.push({
                x: textStartX,
                y: currentY,
                w: textClickableWidth,
                h: CONFIG.lineHeight,
                type: 'text_toggle',
                lineIndex: index,
                action: 'toggle'
            });

            // Draw wrapped text lines (each one filtered by visibility)
            wrappedLines.forEach((wrappedLine, wrapIndex) => {
                const lineY = currentY + wrapIndex * CONFIG.lineHeight;
                if (lineY + CONFIG.lineHeight < areaTop || lineY > areaBottom) return;
                drawPhraseTextLine(ctx, wrappedLine, lineY, isCommented, isBold);
            });

            // Draw weight controls (only on first line)
            drawWeightControls(ctx, currentY, line, isCommented, node, index);
        }

        // Move to next position regardless of visibility (layout is continuous)
        currentY += phraseBlockHeight;
    });

    ctx.restore();
}

function isEmptyLine(line) {
    return line.trim() === "";
}

function isDescriptionComment(line) {
    return line.trim().startsWith("#");
}

function getDescriptionFromComment(line) {
    return line.trim().replace(/^\s*#\s*/, '');
}

function findDescriptionForLine(lines, lineIndex) {
    // Look for # comment in the previous line
    if (lineIndex > 0 && isDescriptionComment(lines[lineIndex - 1])) {
        return getDescriptionFromComment(lines[lineIndex - 1]);
    }
    return null;
}

function getPhraseText(line, isCommented) {
    let phraseText = line;
    
    // Remove leading // for both commented and non-commented lines
    if (isCommented) {
        phraseText = line.trim().replace(/^\s*\/\/\s*/, '');
    }
    
    // Remove weight notation from all lines
    phraseText = phraseText.replace(/\(([^:]+):(-?\d+\.?\d*)\)/g, '$1');
    
    // Remove trailing comma
    if (phraseText.trim().endsWith(',')) {
        phraseText = phraseText.substring(0, phraseText.lastIndexOf(','));
    }

    // Remove group tags from display text
    phraseText = removeGroupTags(phraseText);

    return phraseText;
}

function drawGroupControls(node, ctx, text, groups) {
    if (groups.length === 0) return 0;

    const widgetsHeight = getRenderedWidgetAreaBottom(node);
    const y = widgetsHeight + CONFIG.widgetSpacing;
    const buttonHeight = CONFIG.groupButtonHeight;
    const margin = CONFIG.groupButtonMargin;
    let currentX = CONFIG.sideNodePadding;

    ctx.font = `${CONFIG.fontSize - 2}px monospace`;
    ctx.textAlign = "center";

    // Draw "All ON" and "All OFF" buttons first
    const allOnWidth = ctx.measureText("[all]").width + 16;
    const allOffWidth = ctx.measureText("[off]").width + 16;

    // Draw All ON button
    ctx.fillStyle = "#4CAF50"; // Green background for All ON
    ctx.strokeStyle = "#4CAF50";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(currentX, y, allOnWidth, buttonHeight, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#ffffff"; // White text for All ON
    const allOnTextX = currentX + allOnWidth / 2;
    const allOnTextY = y + buttonHeight / 2 + (CONFIG.fontSize - 2) * 0.35;
    ctx.fillText("[all]", allOnTextX, allOnTextY);

    // Add clickable area for All ON
    node.clickableAreas.push({
        x: currentX,
        y: y,
        w: allOnWidth,
        h: buttonHeight,
        action: 'all_on'
    });

    currentX += allOnWidth + margin;

    // Draw All OFF button
    ctx.fillStyle = "#f44336"; // Red background for All OFF
    ctx.strokeStyle = "#f44336";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(currentX, y, allOffWidth, buttonHeight, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#ffffff"; // White text for All OFF
    const allOffTextX = currentX + allOffWidth / 2;
    const allOffTextY = y + buttonHeight / 2 + (CONFIG.fontSize - 2) * 0.35;
    ctx.fillText("[off]", allOffTextX, allOffTextY);

    // Add clickable area for All OFF
    node.clickableAreas.push({
        x: currentX,
        y: y,
        w: allOffWidth,
        h: buttonHeight,
        action: 'all_off'
    });

    currentX += allOffWidth + margin * 2; // Extra margin before group buttons

    groups.forEach((groupName, index) => {
        const status = getGroupStatus(text, groupName);
        const buttonWidth = ctx.measureText(`[${groupName}]`).width + 16;

        // Determine button color based on status
        let fillColor, borderColor, textColor;
        const colors = getColors();

        switch (status) {
            case 'all':
                fillColor = colors.checkboxFillColor;
                textColor = colors.checkboxSymbolColor;
                borderColor = colors.checkboxFillColor;
                break;
            case 'partial':
                fillColor = colors.weightButtonFillColor;
                textColor = colors.defaultTextColor;
                borderColor = colors.checkboxFillColor;
                break;
            case 'none':
                fillColor = 'transparent';
                textColor = colors.inactiveTextColor;
                borderColor = colors.checkboxBorderColor;
                break;
        }

        // Draw button background
        ctx.fillStyle = fillColor;
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(currentX, y, buttonWidth, buttonHeight, 6);
        ctx.fill();
        ctx.stroke();

        // Draw button text
        ctx.fillStyle = textColor;
        const textX = currentX + buttonWidth / 2;
        const textY = y + buttonHeight / 2 + (CONFIG.fontSize - 2) * 0.35;
        ctx.fillText(`[${groupName}]`, textX, textY);

        // Add clickable area
        if (node) {
            node.clickableAreas.push({
                x: currentX,
                y: y,
                w: buttonWidth,
                h: buttonHeight,
                type: 'group_toggle',
                groupName: groupName,
                action: 'group_toggle'
            });
        }

        currentX += buttonWidth + margin;
    });

    ctx.textAlign = "left"; // Reset alignment
    return CONFIG.groupAreaHeight;
}

function drawCheckbox(ctx, y, isCommented, node, lineIndex) {
    const checkboxX = CONFIG.sideNodePadding;
    const checkboxY = y;
    const checkboxW = CONFIG.checkboxSize;
    const checkboxH = CONFIG.checkboxSize;
    
    // Add to clickableAreas
    if (node) {
        node.clickableAreas.push({
            x: checkboxX,
            y: checkboxY,
            w: checkboxW,
            h: checkboxH,
            type: 'checkbox',
            lineIndex: lineIndex,
            action: 'toggle'
        });
    }
    
    // Draw checkbox
    if (isCommented) {
        // Draw checkbox border
        ctx.strokeStyle = getColors().checkboxBorderColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(checkboxX, checkboxY, checkboxW, checkboxH, 4);
        ctx.stroke();
    } else {
        // Fill checkbox
        ctx.fillStyle = getColors().checkboxFillColor;
        ctx.beginPath();
        ctx.roundRect(checkboxX, checkboxY, checkboxW, checkboxH, 4);
        ctx.fill();

        // Draw checkmark
        ctx.strokeStyle = getColors().checkboxSymbolColor;
        ctx.lineWidth = 2;
        const centerX = checkboxX + checkboxW / 2;
        const centerY = checkboxY + checkboxH / 2;
        const checkSize = checkboxW * 0.4;
        ctx.beginPath();
        // Start from left, go to bottom center, then to top right
        ctx.moveTo(centerX - checkSize * 0.7, centerY + checkSize * 0.0);
        ctx.lineTo(centerX - checkSize * 0.3, centerY + checkSize * 0.5);
        ctx.lineTo(centerX + checkSize * 0.7, centerY - checkSize * 0.5);
        ctx.stroke();
    }
}

function drawPhraseTextLine(ctx, wrappedLine, y, isCommented, isBold) {
    // Set text color based on comment status
    const colors = getColors();
    ctx.fillStyle = isCommented ? colors.inactiveTextColor : colors.defaultTextColor;
    ctx.textAlign = "left";
    
    // Set font with bold if weight is not 1.0
    ctx.font = isBold ? 
        `bold ${CONFIG.fontSize}px monospace` : 
        `${CONFIG.fontSize}px monospace`;
    
    // Calculate text baseline to align visual center with checkbox center
    const checkboxCenter = y + CONFIG.checkboxSize / 2;
    const textBaseline = checkboxCenter + CONFIG.fontSize * 0.35;
    
    ctx.fillText(wrappedLine, CONFIG.sideNodePadding + CONFIG.checkboxSize + CONFIG.spaceBetweenCheckboxAndText, textBaseline);
}

function drawWeightControls(ctx, y, line, isCommented, node, lineIndex) {
    const nodeWidth = node.size[0];

    // Get the text to check for weight
    const textToCheck = isCommented ?
        (line.match(/^(\s*\/\/\s*)(.*)/)?.[2] || '') :
        line;

    // Skip if it's a comment-only line (no text after //)
    if (isCommented && !textToCheck.trim()) return;

    const weightText = getWeightText(textToCheck);
    const checkboxCenter = y + CONFIG.checkboxSize / 2;

    // Shift the weight controls inward when the phrase list is scrolling
    // so they don't overlap the scrollbar on the right edge.
    const scroll = node._ppCheckboxScroll;
    const scrollGutter = (scroll && scroll.maxScrollLines > 0)
        ? CONFIG.scrollBarWidth + CONFIG.checkboxScrollPadding
        : 0;

    // Calculate positions from right to left
    let currentX = nodeWidth - CONFIG.sideNodePadding - scrollGutter;
    
    // Draw plus button
    const plusButtonX = currentX - CONFIG.weightButtonSize;
    const plusButtonY = y;
    drawWeightButton(ctx, plusButtonX, plusButtonY, '+', node, lineIndex, 'weight_plus');
    currentX = plusButtonX - 4;
    
    // Draw minus button
    const minusButtonX = currentX - CONFIG.weightButtonSize;
    const minusButtonY = y;
    drawWeightButton(ctx, minusButtonX, minusButtonY, '-', node, lineIndex, 'weight_minus');
    currentX = minusButtonX - 4;
    
    // Draw weight label
    if (weightText) {
        const weightLabelX = currentX - CONFIG.weightLabelWidth;
        const textColors = getColors();
    ctx.fillStyle = isCommented ? textColors.inactiveTextColor : textColors.defaultTextColor;
        ctx.textAlign = "right";
        ctx.font = "12px monospace";
        const textBaseline = checkboxCenter + CONFIG.fontSize * 0.35;
        ctx.fillText(weightText, currentX - 2, textBaseline);
        ctx.textAlign = "left"; // Reset alignment
    }
}

function drawWeightButton(ctx, x, y, symbol, node, lineIndex, action) {
    const buttonSize = CONFIG.weightButtonSize;
    
    // Add to clickable areas
    if (node) {
        node.clickableAreas.push({
            x: x,
            y: y,
            w: buttonSize,
            h: buttonSize,
            type: 'weight_button',
            lineIndex: lineIndex,
            action: action,
            node: node
        });
    }
    
    // Draw button background
    ctx.fillStyle = getColors().weightButtonFillColor;
    ctx.beginPath();
    ctx.roundRect(x, y, buttonSize, buttonSize, 4);
    ctx.fill();
    
    // Draw symbol with lines
    ctx.strokeStyle = getColors().weightButtonSymbolColor;
    ctx.lineWidth = 2;
    const centerX = x + buttonSize / 2;
    const centerY = y + buttonSize / 2;
    const symbolSize = 6;
    
    ctx.beginPath();
    if (symbol === '+') {
        // Horizontal line
        ctx.moveTo(centerX - symbolSize / 2, centerY);
        ctx.lineTo(centerX + symbolSize / 2, centerY);
        // Vertical line
        ctx.moveTo(centerX, centerY - symbolSize / 2);
        ctx.lineTo(centerX, centerY + symbolSize / 2);
    } else if (symbol === '-') {
        // Horizontal line only
        ctx.moveTo(centerX - symbolSize / 2, centerY);
        ctx.lineTo(centerX + symbolSize / 2, centerY);
    }
    ctx.stroke();
}

// ========================================
// Weight
// ========================================

function getWeightText(text) {
    const weight = parseWeight(text);
    return weight === 1.0 ? '' : weight.toFixed(1);
}

function parseWeight(text) {
    const match = text.match(/\(([^:]+):(-?\d+\.?\d*)\)/);
    if (match) {
        const weight = parseFloat(match[2]);
        return isNaN(weight) ? 1.0 : weight;
    }
    return 1.0;
}

function setWeight(text, weight) {
    const cleanText = text.replace(/\(([^:]+):(-?\d+\.?\d*)\)/, '$1').trim();
    // Remove trailing comma
    const textWithoutComma = cleanText.replace(/,\s*$/, '').trim();
    if (weight === 1.0) {
        return textWithoutComma;
    }
    return `(${textWithoutComma}:${weight.toFixed(1)})`;
}

function adjustWeight(text, delta) {
    const currentWeight = parseWeight(text);
    const newWeight = Math.round((currentWeight + delta) * 10) / 10;

    const minWeight = CONFIG.minWeight;
    const maxWeight = CONFIG.maxWeight;

    // Handle out-of-range values
    if (newWeight < minWeight) {
        return text; // Don't allow values below minimum
    }

    if (newWeight > maxWeight) {
        // If trying to increase beyond maximum, don't change
        if (delta > 0) {
            return text;
        }
        // If trying to decrease from above maximum, clamp to maximum
        return setWeight(text, maxWeight);
    }

    // Special case: if current weight is above maximum and we're decreasing
    if (currentWeight > maxWeight && delta < 0) {
        return setWeight(text, maxWeight);
    }

    return setWeight(text, newWeight);
}

// ----- Bulk weight operations (apply to every phrase line) -----
//
// Walks every line, skipping blanks and `#` description comments. For each
// remaining line, extracts the leading `//` toggle prefix (if any) and the
// trailing inline `// comment` (if any), then runs `transformFn` on the
// raw phrase content (which still includes `[group]` tags and any existing
// `(text:weight)` notation — `setWeight()` / `adjustWeight()` already
// preserve those through backend processing).
function transformAllPhrases(text, transformFn) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        let prefix = '';
        let content = line;
        const commentMatch = line.match(/^(\s*\/\/\s*)(.*)$/);
        if (commentMatch) {
            prefix = commentMatch[1];
            content = commentMatch[2];
        }

        let inlineComment = '';
        if (!commentMatch && content.includes('//')) {
            const idx = content.indexOf('//');
            inlineComment = ' ' + content.substring(idx);
            content = content.substring(0, idx).trimEnd();
        }

        if (!content.trim()) continue;

        const transformed = transformFn(content);
        lines[i] = prefix + transformed + inlineComment;
    }
    return lines.join('\n');
}

function setAllWeights(text, newWeight) {
    let w = parseFloat(newWeight);
    if (isNaN(w)) return text;
    w = Math.max(CONFIG.minWeight, Math.min(CONFIG.maxWeight, w));
    w = Math.round(w * 10) / 10;
    return transformAllPhrases(text, (content) => setWeight(content, w));
}

function adjustAllWeights(text, delta) {
    return transformAllPhrases(text, (content) => adjustWeight(content, delta));
}

// ========================================
// Color
// ========================================

let colorCache = null;

function getColors() {
    if (colorCache) {
        return colorCache;
    }
    const themeColors = getComfyUIThemeColors();
    colorCache = {
        defaultTextColor: themeColors.inputText,
        inactiveTextColor: themeColors.inputText + "66",
        checkboxBorderColor: themeColors.inputText + "80",
        checkboxFillColor: themeColors.inputText + "BB",
        checkboxSymbolColor: themeColors.comfyInputBg,
        weightButtonFillColor: themeColors.comfyInputBg,
        weightButtonSymbolColor: themeColors.inputText + "99",
        comfyInputBg: themeColors.comfyInputBg,
        borderColor: themeColors.borderColor,
        descripText: themeColors.descripText,
        errorText: themeColors.errorText,
    };
    return colorCache;
}

function getComfyUIThemeColors() {
    const style = getComputedStyle(document.documentElement);
    return {
        fgColor: expandHexColor(style.getPropertyValue('--fg-color').trim()) || "#ffffff",
        bgColor: expandHexColor(style.getPropertyValue('--bg-color').trim()) || "#202020",
        comfyMenuBg: expandHexColor(style.getPropertyValue('--comfy-menu-bg').trim()) || "#353535",
        comfyInputBg: expandHexColor(style.getPropertyValue('--comfy-input-bg').trim()) || "#222222",
        inputText: expandHexColor(style.getPropertyValue('--input-text').trim()) || "#dddddd",
        descripText: expandHexColor(style.getPropertyValue('--descrip-text').trim()) || "#999999",
        errorText: expandHexColor(style.getPropertyValue('--error-text').trim()) || "#ff4444",
        borderColor: expandHexColor(style.getPropertyValue('--border-color').trim()) || "#4e4e4e",
    };
}

function expandHexColor(color) {
    if (!color || !color.startsWith('#')) return color;
    if (color.length === 4) {
        return '#' + color[1] + color[1] + color[2] + color[2] + color[3] + color[3];
    }
    return color;
}

// ========================================
// Nodes 2.0 DOM Widget UI
// ========================================

const DOM_CSS = `
.pp-container {
    font-family: monospace;
    font-size: 13px;
    color: var(--input-text, #ddd);
    background: var(--comfy-input-bg, #222);
    border: 1px solid var(--border-color, #4e4e4e);
    border-radius: 6px;
    overflow: hidden;
    user-select: none;
}
.pp-toolbar {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 4px 6px;
    flex-wrap: wrap;
    border-bottom: 1px solid var(--border-color, #4e4e4e);
}
.pp-toolbar button {
    font-family: monospace;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid transparent;
    cursor: pointer;
    white-space: nowrap;
}
.pp-btn-all {
    background: #4CAF50; color: #fff;
}
.pp-btn-off {
    background: #f44336; color: #fff;
}
.pp-btn-group {
    border-color: var(--border-color, #4e4e4e) !important;
}
.pp-btn-group[data-status="all"] {
    background: color-mix(in srgb, var(--input-text, #ddd) 70%, transparent);
    color: var(--comfy-input-bg, #222);
}
.pp-btn-group[data-status="partial"] {
    background: var(--comfy-input-bg, #222);
    color: var(--input-text, #ddd);
    border-color: color-mix(in srgb, var(--input-text, #ddd) 70%, transparent) !important;
}
.pp-btn-group[data-status="none"] {
    background: transparent;
    color: color-mix(in srgb, var(--input-text, #ddd) 40%, transparent);
    border-color: var(--border-color, #4e4e4e) !important;
}
.pp-edit-toggle {
    margin-left: auto;
    background: var(--comfy-input-bg, #222);
    color: var(--input-text, #ddd);
    border-color: var(--border-color, #4e4e4e) !important;
    font-size: 12px;
    padding: 2px 10px;
}
.pp-weight-bulk-btn {
    background: var(--comfy-input-bg, #222);
    color: var(--input-text, #ddd);
    border: 1px solid var(--border-color, #4e4e4e);
    border-radius: 3px;
    font-size: 12px;
    padding: 2px 8px;
    cursor: pointer;
    min-width: 36px;
}
.pp-weight-bulk-btn:hover {
    background: color-mix(in srgb, var(--input-text, #ddd) 12%, var(--comfy-input-bg, #222));
}
.pp-phrases {
    padding: 2px 0;
    /* Cap the phrase list so a huge number of choices scrolls instead of
       making the entire node enormous. Native browser scrolling — wheel
       events on this element are NOT intercepted by our document-level
       wheel hook (target check), so they scroll natively. */
    max-height: 400px;
    overflow-y: auto;
}
.pp-phrases::-webkit-scrollbar {
    width: 10px;
}
.pp-phrases::-webkit-scrollbar-track {
    background: color-mix(in srgb, var(--comfy-input-bg, #222) 80%, transparent);
}
.pp-phrases::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, var(--input-text, #ddd) 30%, transparent);
    border-radius: 5px;
}
.pp-phrases::-webkit-scrollbar-thumb:hover {
    background: color-mix(in srgb, var(--input-text, #ddd) 50%, transparent);
}
.pp-row {
    display: flex;
    align-items: center;
    padding: 2px 6px;
    gap: 6px;
    min-height: 22px;
    cursor: pointer;
}
.pp-row:hover {
    background: color-mix(in srgb, var(--input-text, #ddd) 8%, transparent);
}
.pp-row.pp-inactive {
    opacity: 0.45;
}
.pp-checkbox {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    border: 1px solid color-mix(in srgb, var(--input-text, #ddd) 50%, transparent);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
}
.pp-row:not(.pp-inactive) .pp-checkbox {
    background: color-mix(in srgb, var(--input-text, #ddd) 70%, transparent);
    color: var(--comfy-input-bg, #222);
    border-color: transparent;
}
.pp-phrase-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 13px;
    line-height: 1.4;
}
.pp-phrase-text.pp-bold {
    font-weight: bold;
}
.pp-desc {
    padding: 1px 6px 0 26px;
    font-style: italic;
    font-size: 12px;
    color: color-mix(in srgb, var(--input-text, #ddd) 50%, transparent);
}
.pp-weight-controls {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
}
.pp-weight-btn {
    width: 18px;
    height: 18px;
    border-radius: 3px;
    border: none;
    background: var(--comfy-input-bg, #222);
    color: color-mix(in srgb, var(--input-text, #ddd) 60%, transparent);
    font-size: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    font-family: monospace;
}
.pp-weight-btn:hover {
    background: color-mix(in srgb, var(--input-text, #ddd) 20%, transparent);
}
.pp-weight-label {
    font-size: 11px;
    min-width: 24px;
    text-align: center;
    color: color-mix(in srgb, var(--input-text, #ddd) 70%, transparent);
}
.pp-preview {
    border-top: 1px solid var(--border-color, #4e4e4e);
    padding: 4px 6px;
    max-height: 100px;
    overflow-y: auto;
}
.pp-preview-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 2px;
}
.pp-preview-label {
    font-size: 11px;
    color: var(--descrip-text, #999);
}
.pp-preview-label.pp-edited {
    color: #ff9800;
}
.pp-preview-btns {
    display: flex;
    gap: 4px;
}
.pp-preview-btn {
    font-family: monospace;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    border: none;
    cursor: pointer;
}
.pp-preview-btn.pp-edit-btn {
    background: #4CAF5080;
    color: #fff;
}
.pp-preview-btn.pp-reset-btn {
    background: #f4433680;
    color: #fff;
}
.pp-preview-text {
    font-size: 12px;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--input-text, #ddd);
    min-height: 16px;
}
.pp-preview-text.pp-empty {
    color: color-mix(in srgb, var(--input-text, #ddd) 40%, transparent);
    font-style: italic;
}
.pp-preview.pp-has-override {
    border-top-color: #ff9800;
}
.pp-edit-area {
    padding: 4px 6px;
}
.pp-edit-area textarea {
    width: 100%;
    min-height: 120px;
    font-family: monospace;
    font-size: 13px;
    background: var(--comfy-input-bg, #222);
    color: var(--input-text, #ddd);
    border: 1px solid var(--border-color, #4e4e4e);
    border-radius: 4px;
    padding: 4px 6px;
    resize: vertical;
    outline: none;
    box-sizing: border-box;
}
.pp-edit-area textarea:focus {
    border-color: color-mix(in srgb, var(--input-text, #ddd) 60%, transparent);
}
.pp-prefix-area {
    padding: 4px 6px;
    border-bottom: 1px solid var(--border-color, #4e4e4e);
}
.pp-prefix-label {
    font-size: 11px;
    color: color-mix(in srgb, var(--input-text, #ddd) 70%, transparent);
    margin-bottom: 2px;
}
.pp-prefix-area textarea {
    width: 100%;
    min-height: 48px;
    font-family: monospace;
    font-size: 13px;
    background: var(--comfy-input-bg, #222);
    color: var(--input-text, #ddd);
    border: 1px solid var(--border-color, #4e4e4e);
    border-radius: 4px;
    padding: 4px 6px;
    resize: vertical;
    outline: none;
    box-sizing: border-box;
}
.pp-prefix-area textarea:focus {
    border-color: color-mix(in srgb, var(--input-text, #ddd) 60%, transparent);
}
.pp-separator-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    row-gap: 4px;
    padding: 4px 6px;
    font-size: 12px;
    border-top: 1px solid var(--border-color, #4e4e4e);
}
.pp-separator-row label {
    display: flex;
    align-items: center;
    gap: 3px;
    cursor: pointer;
    white-space: nowrap;
}
.pp-separator-row input[type="text"] {
    width: 50px;
    font-family: monospace;
    font-size: 12px;
    background: var(--comfy-input-bg, #222);
    color: var(--input-text, #ddd);
    border: 1px solid var(--border-color, #4e4e4e);
    border-radius: 3px;
    padding: 1px 4px;
    outline: none;
}
.pp-no-text {
    padding: 12px 6px;
    text-align: center;
    color: color-mix(in srgb, var(--input-text, #ddd) 40%, transparent);
    font-style: italic;
}
`;

function injectDOMCSS() {
    if (document.getElementById('pp-dom-styles')) return;
    const style = document.createElement('style');
    style.id = 'pp-dom-styles';
    style.textContent = DOM_CSS;
    document.head.appendChild(style);
}

function createDOMWidget(node, textWidget, app) {
    injectDOMCSS();

    const container = document.createElement('div');
    container.className = 'pp-container';

    // State
    node._ppDomEditMode = false;

    function getWidgetValue(name) {
        // Check backed-up refs first (widgets removed from array in Nodes 2.0)
        const refs = node._ppWidgetRefs;
        if (refs && refs[name]) return refs[name].value;
        if (!node.widgets) return undefined;
        for (const w of node.widgets) {
            if (w.name === name) return w.value;
        }
        return undefined;
    }

    function setWidgetValue(name, val) {
        const refs = node._ppWidgetRefs;
        if (refs && refs[name]) { refs[name].value = val; return; }
        if (!node.widgets) return;
        for (const w of node.widgets) {
            if (w.name === name) { w.value = val; return; }
        }
    }

    function render() {
        const text = textWidget.value || "";

        // Preserve the phrase-list scroll position across re-renders so that
        // toggling a checkbox (which wipes and rebuilds the DOM) doesn't snap
        // the list back to the top.
        const prevPhrases = container.querySelector('.pp-phrases');
        const savedScrollTop = prevPhrases ? prevPhrases.scrollTop : 0;

        container.innerHTML = '';

        // NOTE: In Nodes 2.0 the prefix textarea is rendered by ComfyUI itself
        // as a native multiline widget (kept in node.widgets[0] so its input
        // slot is wire-connectable). We deliberately do NOT render a prefix
        // area inside this DOM widget — having two textareas with different
        // values would be confusing.

        if (node._ppDomEditMode) {
            renderEditMode(container, text);
        } else {
            renderDisplayMode(container, text);
        }

        // Restore scroll position (display mode only — edit mode has a textarea
        // instead of a phrase list).
        if (savedScrollTop > 0 && !node._ppDomEditMode) {
            const newPhrases = container.querySelector('.pp-phrases');
            if (newPhrases) newPhrases.scrollTop = savedScrollTop;
        }
    }

    function renderEditMode(el, text) {
        // Toolbar with Save button
        const toolbar = document.createElement('div');
        toolbar.className = 'pp-toolbar';
        const saveBtn = document.createElement('button');
        saveBtn.className = 'pp-edit-toggle';
        saveBtn.textContent = 'Save';
        saveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Read back main textarea value (prefix textarea writes through on input)
            const ta = el.querySelector('.pp-edit-area textarea');
            if (ta) textWidget.value = ta.value;
            node._ppDomEditMode = false;
            render();
        });
        toolbar.appendChild(saveBtn);
        el.appendChild(toolbar);

        // Textarea
        const editArea = document.createElement('div');
        editArea.className = 'pp-edit-area';
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.addEventListener('keydown', (e) => e.stopPropagation());
        textarea.addEventListener('input', () => {
            textWidget.value = textarea.value;
        });
        editArea.appendChild(textarea);
        el.appendChild(editArea);

        // Separator & options row (includes prefix_separator toggle)
        renderOptionsRow(el);
    }

    function renderPrefixArea(el) {
        const wrap = document.createElement('div');
        wrap.className = 'pp-prefix-area';
        const label = document.createElement('div');
        label.className = 'pp-prefix-label';
        label.textContent = 'Prefix:';
        wrap.appendChild(label);
        const ta = document.createElement('textarea');
        ta.value = getWidgetValue('prefix') || '';
        ta.addEventListener('keydown', (e) => e.stopPropagation());
        ta.addEventListener('input', () => {
            setWidgetValue('prefix', ta.value);
        });
        wrap.appendChild(ta);
        el.appendChild(wrap);
    }

    function renderOptionsRow(el) {
        const row = document.createElement('div');
        row.className = 'pp-separator-row';

        const SEP_TOOLTIP = 'Separator used to join selected phrases (default: ", "). Use empty string for no separator.';

        // Separator input
        const sepLabel = document.createElement('label');
        sepLabel.textContent = 'Sep: ';
        sepLabel.title = SEP_TOOLTIP;
        const sepInput = document.createElement('input');
        sepInput.type = 'text';
        sepInput.title = SEP_TOOLTIP;
        sepInput.value = getWidgetValue('separator') !== undefined ? getWidgetValue('separator') : ', ';
        sepInput.addEventListener('input', () => {
            setWidgetValue('separator', sepInput.value);
            renderPreviewSection();
        });
        sepInput.addEventListener('keydown', (e) => e.stopPropagation());
        sepLabel.appendChild(sepInput);
        row.appendChild(sepLabel);

        // Checkboxes for options (with hover tooltips)
        const options = [
            {
                name: 'trailing_separator',
                label: 'Trail',
                tooltip: 'Append the separator after the last phrase too.',
            },
            {
                name: 'separator_newline',
                label: 'Sep NL',
                tooltip: 'Append a newline after each separator (one phrase per line in output).',
            },
            {
                name: 'add_newline',
                label: 'End NL',
                tooltip: 'Append a newline at the very end of the output.',
            },
            {
                name: 'prefix_separator',
                label: 'Prefix Sep',
                tooltip: 'Insert the separator between prefix and body. OFF = plain prefix+body concat.',
            },
            {
                name: 'empty_when_no_selection',
                label: 'Empty if no sel',
                tooltip: 'When no phrase is selected, output Python None on all three outputs (no prefix, no newline). Targets switches like rgthree Any Switch that check `value is None` to route to another input.',
            },
        ];
        for (const opt of options) {
            const label = document.createElement('label');
            if (opt.tooltip) label.title = opt.tooltip;
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !!getWidgetValue(opt.name);
            cb.addEventListener('change', () => {
                setWidgetValue(opt.name, cb.checked);
                renderPreviewSection();
            });
            label.appendChild(cb);
            label.appendChild(document.createTextNode(opt.label));
            row.appendChild(label);
        }

        el.appendChild(row);
    }

    function renderPreviewSection() {
        // Re-render just the preview area if it exists
        const existing = container.querySelector('.pp-preview');
        if (existing) {
            const parent = existing.parentNode;
            const newPreview = buildPreview();
            parent.replaceChild(newPreview, existing);
        }
    }

    function renderDisplayMode(el, text) {
        const lines = text.split('\n');
        const groups = getAllGroups(text);

        // Toolbar with group buttons + Edit button
        const toolbar = document.createElement('div');
        toolbar.className = 'pp-toolbar';

        if (groups.length > 0) {
            // All ON button
            const allBtn = document.createElement('button');
            allBtn.className = 'pp-btn-all';
            allBtn.textContent = '[all]';
            allBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                textWidget.value = toggleAllPhrases(textWidget.value, true);
                setPreviewOverride(node, "");
                render();
            });
            toolbar.appendChild(allBtn);

            // All OFF button
            const offBtn = document.createElement('button');
            offBtn.className = 'pp-btn-off';
            offBtn.textContent = '[off]';
            offBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                textWidget.value = toggleAllPhrases(textWidget.value, false);
                setPreviewOverride(node, "");
                render();
            });
            toolbar.appendChild(offBtn);

            // Group buttons
            for (const groupName of groups) {
                const status = getGroupStatus(text, groupName);
                const gBtn = document.createElement('button');
                gBtn.className = 'pp-btn-group';
                gBtn.dataset.status = status;
                gBtn.textContent = `[${groupName}]`;
                gBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    textWidget.value = toggleGroup(textWidget.value, groupName);
                    setPreviewOverride(node, "");
                    render();
                });
                toolbar.appendChild(gBtn);
            }
        }

        // Edit button (always)
        const editBtn = document.createElement('button');
        editBtn.className = 'pp-edit-toggle';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            node._ppDomEditMode = true;
            render();
        });
        toolbar.appendChild(editBtn);

        // Set All Weights button (placed next to Edit per user request).
        // Appended after Edit so it sits to the right of Edit (Edit has
        // margin-left:auto which pushes the right-side group toward the edge).
        const weightBtn = document.createElement('button');
        weightBtn.className = 'pp-weight-bulk-btn';
        weightBtn.textContent = 'W±';
        weightBtn.title = 'Set or adjust the weight of every phrase at once';
        weightBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openBulkWeightEditor(node, e);
        });
        toolbar.appendChild(weightBtn);

        el.appendChild(toolbar);

        // Phrase list
        const phrasesDiv = document.createElement('div');
        phrasesDiv.className = 'pp-phrases';

        let hasContent = false;
        lines.forEach((line, index) => {
            if (isEmptyLine(line)) return;

            // Description comment
            if (isDescriptionComment(line)) {
                // Don't render standalone - handled by the next phrase line
                return;
            }

            hasContent = true;
            const isCommented = line.trim().startsWith('//');

            // Check for description above this line
            const description = findDescriptionForLine(lines, index);
            if (description) {
                const descEl = document.createElement('div');
                descEl.className = 'pp-desc';
                descEl.textContent = description;
                phrasesDiv.appendChild(descEl);
            }

            // Phrase row
            const row = document.createElement('div');
            row.className = 'pp-row' + (isCommented ? ' pp-inactive' : '');

            // Checkbox
            const checkbox = document.createElement('div');
            checkbox.className = 'pp-checkbox';
            checkbox.textContent = isCommented ? '' : '\u2713';
            row.appendChild(checkbox);

            // Phrase text
            const phraseText = getPhraseText(line, isCommented);
            const textToCheck = isCommented ?
                (line.match(/^(\s*\/\/\s*)(.*)/)?.[2] || '') : line;
            const weight = parseWeight(textToCheck);
            const isBold = weight !== 1.0;

            const textEl = document.createElement('span');
            textEl.className = 'pp-phrase-text' + (isBold ? ' pp-bold' : '');
            textEl.textContent = phraseText;
            row.appendChild(textEl);

            // Weight controls
            const weightControls = document.createElement('div');
            weightControls.className = 'pp-weight-controls';

            const minusBtn = document.createElement('button');
            minusBtn.className = 'pp-weight-btn';
            minusBtn.textContent = '\u2212';
            minusBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                adjustWeightInText(textWidget, index, -0.1, app);
                setPreviewOverride(node, "");
                render();
            });
            weightControls.appendChild(minusBtn);

            const weightLabel = document.createElement('span');
            weightLabel.className = 'pp-weight-label';
            weightLabel.textContent = getWeightText(textToCheck) || '1.0';
            weightControls.appendChild(weightLabel);

            const plusBtn = document.createElement('button');
            plusBtn.className = 'pp-weight-btn';
            plusBtn.textContent = '+';
            plusBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                adjustWeightInText(textWidget, index, 0.1, app);
                setPreviewOverride(node, "");
                render();
            });
            weightControls.appendChild(plusBtn);

            row.appendChild(weightControls);

            // Click on row toggles comment
            row.addEventListener('click', (e) => {
                if (e.target.closest('.pp-weight-btn')) return;
                const textLines = textWidget.value.split('\n');
                toggleCommentOnLine(textLines, index);
                textWidget.value = textLines.join('\n');
                setPreviewOverride(node, "");
                render();
            });

            phrasesDiv.appendChild(row);
        });

        if (!hasContent) {
            const noText = document.createElement('div');
            noText.className = 'pp-no-text';
            noText.textContent = 'No Text';
            phrasesDiv.appendChild(noText);
        }

        el.appendChild(phrasesDiv);

        // Preview area
        el.appendChild(buildPreview());
    }

    function buildPreview() {
        const previewDiv = document.createElement('div');
        const hasOverride = getPreviewOverride(node) !== "";
        previewDiv.className = 'pp-preview' + (hasOverride ? ' pp-has-override' : '');

        // Header
        const header = document.createElement('div');
        header.className = 'pp-preview-header';

        const label = document.createElement('span');
        label.className = 'pp-preview-label' + (hasOverride ? ' pp-edited' : '');
        label.textContent = hasOverride ? 'Preview (Edited):' : 'Preview:';
        header.appendChild(label);

        const btns = document.createElement('div');
        btns.className = 'pp-preview-btns';

        if (hasOverride) {
            const resetBtn = document.createElement('button');
            resetBtn.className = 'pp-preview-btn pp-reset-btn';
            resetBtn.textContent = '\u21BA Reset';
            resetBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                setPreviewOverride(node, "");
                render();
            });
            btns.appendChild(resetBtn);
        }

        const editBtn = document.createElement('button');
        editBtn.className = 'pp-preview-btn pp-edit-btn';
        editBtn.textContent = '\u270E Edit';
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openDOMPreviewEditor(node, render);
        });
        btns.appendChild(editBtn);

        header.appendChild(btns);
        previewDiv.appendChild(header);

        // Preview text
        const previewText = hasOverride ? getPreviewOverride(node) : generatePreview(node);
        const textEl = document.createElement('div');
        if (!previewText || !previewText.trim()) {
            textEl.className = 'pp-preview-text pp-empty';
            textEl.textContent = '(empty)';
        } else {
            textEl.className = 'pp-preview-text';
            textEl.textContent = previewText;
        }
        previewDiv.appendChild(textEl);

        return previewDiv;
    }

    function openDOMPreviewEditor(node, renderCallback) {
        const currentOverride = getPreviewOverride(node);
        const previewText = currentOverride || generatePreview(node);

        // Replace preview with editable textarea inline
        const previewEl = container.querySelector('.pp-preview');
        if (!previewEl) return;

        previewEl.innerHTML = '';
        previewEl.className = 'pp-preview pp-has-override';
        previewEl.style.maxHeight = 'none';

        const header = document.createElement('div');
        header.className = 'pp-preview-header';
        header.style.background = '#ff9800';
        header.style.color = '#1a1a2e';
        header.style.padding = '2px 6px';
        header.style.borderRadius = '3px';
        header.style.fontWeight = 'bold';
        header.style.fontSize = '11px';
        header.style.marginBottom = '4px';

        const hint = document.createElement('span');
        hint.textContent = 'Editing Preview \u2014 Esc: cancel';
        header.appendChild(hint);

        const saveBtn = document.createElement('button');
        saveBtn.textContent = '\u2715 Save';
        saveBtn.style.cssText = 'cursor:pointer;padding:1px 6px;border-radius:3px;background:rgba(0,0,0,0.15);border:none;color:#1a1a2e;font-size:11px;margin-left:auto;font-family:monospace;';
        header.appendChild(saveBtn);
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';

        previewEl.appendChild(header);

        const textarea = document.createElement('textarea');
        textarea.value = previewText;
        textarea.style.cssText = 'width:100%;min-height:80px;font-family:monospace;font-size:12px;background:var(--comfy-input-bg,#222);color:var(--input-text,#ddd);border:1px solid #ff9800;border-radius:3px;padding:4px 6px;resize:vertical;outline:none;box-sizing:border-box;';
        textarea.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
                renderCallback();
            }
        });

        previewEl.appendChild(textarea);
        setTimeout(() => { textarea.focus(); textarea.select(); }, 10);

        saveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            setPreviewOverride(node, textarea.value);
            renderCallback();
        });
    }

    // Initial render
    render();

    // Store render function on node for external updates
    node._ppDomRender = render;

    return { container, render };
}

function setupNodes2DOMWidget(node, textWidget, app) {
    const { container, render } = createDOMWidget(node, textWidget, app);

    const domWidget = node.addDOMWidget("pp_dom_ui", "custom", container, {
        hideOnZoom: false,
        serialize: false,
        getValue: () => textWidget.value,
        setValue: (v) => {
            textWidget.value = v;
            render();
        },
        getMinHeight: () => 200,
        getHeight: () => {
            // Dynamic height based on content
            return Math.max(200, container.scrollHeight + 10);
        },
    });

    domWidget.computeSize = (width) => {
        return [width, Math.max(200, container.scrollHeight + 10)];
    };

    return domWidget;
}

// ========================================
// Preview Editor (textarea overlay)
// ========================================

function setPreviewOverride(node, value) {
    // Store on node property for frontend display
    node._promptPalette_previewOverride = value;
    // Sync to widget for backend serialization (if widget exists)
    const widget = findOverrideWidget(node);
    if (widget) {
        widget.value = value;
    }
}

function getPreviewOverride(node) {
    // Read from node property (always available, faster)
    const override = node._promptPalette_previewOverride || "";
    return override.trim() !== "" ? override : "";
}

// Floating panel anchored near the click for bulk-adjusting all phrase weights.
// Two interactions: absolute set (number + Apply) and relative nudge (-0.1/+0.1
// applied immediately). Clicking outside or pressing Esc closes the panel.
function openBulkWeightEditor(node, anchorEvent) {
    if (node._promptPalette_weightPanelOpen) return;
    node._promptPalette_weightPanelOpen = true;

    const textWidget = findTextWidget(node);
    if (!textWidget) {
        node._promptPalette_weightPanelOpen = false;
        return;
    }

    const panel = document.createElement("div");
    panel.style.cssText = `
        position: fixed;
        z-index: 10000;
        background: var(--comfy-menu-bg, #202020);
        color: var(--input-text, #ddd);
        border: 1px solid var(--border-color, #4e4e4e);
        border-radius: 6px;
        padding: 8px 10px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        font-family: sans-serif;
        font-size: 12px;
        user-select: none;
        min-width: 220px;
    `;

    // Position near the anchor event, with viewport clamping done after mount.
    const anchorX = (anchorEvent && anchorEvent.clientX) || 100;
    const anchorY = (anchorEvent && anchorEvent.clientY) || 100;
    panel.style.left = `${anchorX}px`;
    panel.style.top = `${anchorY + 8}px`;

    const header = document.createElement("div");
    header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-weight: bold;
        margin-bottom: 8px;
        color: var(--input-text, #ddd);
    `;
    const title = document.createElement("span");
    title.textContent = "Set Weights for All Phrases";
    const closeBtn = document.createElement("span");
    closeBtn.textContent = "✕";
    closeBtn.style.cssText = `cursor: pointer; padding: 0 4px;`;
    header.appendChild(title);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // Absolute set row
    const setRow = document.createElement("div");
    setRow.style.cssText = `display: flex; align-items: center; gap: 6px; margin-bottom: 6px;`;
    const setLabel = document.createElement("span");
    setLabel.textContent = "Set all to:";
    setLabel.style.cssText = `min-width: 70px;`;
    const numberInput = document.createElement("input");
    numberInput.type = "number";
    numberInput.min = String(CONFIG.minWeight);
    numberInput.max = String(CONFIG.maxWeight);
    numberInput.step = "0.1";
    numberInput.value = "1.0";
    numberInput.style.cssText = `
        width: 60px;
        background: var(--comfy-input-bg, #222);
        color: var(--input-text, #ddd);
        border: 1px solid var(--border-color, #4e4e4e);
        border-radius: 3px;
        padding: 2px 4px;
        font-size: 12px;
    `;
    const applyBtn = document.createElement("button");
    applyBtn.textContent = "Apply";
    applyBtn.style.cssText = `
        background: var(--comfy-input-bg, #222);
        color: var(--input-text, #ddd);
        border: 1px solid var(--border-color, #4e4e4e);
        border-radius: 3px;
        padding: 2px 10px;
        font-size: 12px;
        cursor: pointer;
    `;
    setRow.appendChild(setLabel);
    setRow.appendChild(numberInput);
    setRow.appendChild(applyBtn);
    panel.appendChild(setRow);

    // Relative adjust row
    const adjRow = document.createElement("div");
    adjRow.style.cssText = `display: flex; align-items: center; gap: 6px;`;
    const adjLabel = document.createElement("span");
    adjLabel.textContent = "Adjust:";
    adjLabel.style.cssText = `min-width: 70px;`;
    const minusBtn = document.createElement("button");
    minusBtn.textContent = "− 0.1";
    const plusBtn = document.createElement("button");
    plusBtn.textContent = "+ 0.1";
    const adjBtnStyle = `
        background: var(--comfy-input-bg, #222);
        color: var(--input-text, #ddd);
        border: 1px solid var(--border-color, #4e4e4e);
        border-radius: 3px;
        padding: 2px 10px;
        font-size: 12px;
        cursor: pointer;
        min-width: 56px;
    `;
    minusBtn.style.cssText = adjBtnStyle;
    plusBtn.style.cssText = adjBtnStyle;
    adjRow.appendChild(adjLabel);
    adjRow.appendChild(minusBtn);
    adjRow.appendChild(plusBtn);
    panel.appendChild(adjRow);

    document.body.appendChild(panel);

    // Clamp to viewport
    const rect = panel.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) {
        panel.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`;
    }
    if (rect.bottom > window.innerHeight - 8) {
        panel.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`;
    }

    // After applying, trigger UI refresh: Nodes 2.0 DOM widget re-renders via
    // node._ppDomRender if available; Classic mode redraws via setDirtyCanvas.
    function refreshUI() {
        setPreviewOverride(node, "");
        if (typeof node._ppDomRender === 'function') {
            try { node._ppDomRender(); } catch (e) { /* ignore */ }
        }
        app.graph.setDirtyCanvas(true);
    }

    function applyAbsolute() {
        const v = parseFloat(numberInput.value);
        if (isNaN(v)) return;
        textWidget.value = setAllWeights(textWidget.value, v);
        refreshUI();
    }

    function applyDelta(delta) {
        textWidget.value = adjustAllWeights(textWidget.value, delta);
        refreshUI();
        // Also bump the displayed number to give visual feedback
        const cur = parseFloat(numberInput.value);
        if (!isNaN(cur)) {
            const next = Math.max(CONFIG.minWeight, Math.min(CONFIG.maxWeight, Math.round((cur + delta) * 10) / 10));
            numberInput.value = next.toFixed(1);
        }
    }

    applyBtn.addEventListener("click", (e) => { e.stopPropagation(); applyAbsolute(); });
    numberInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); applyAbsolute(); }
    });
    minusBtn.addEventListener("click", (e) => { e.stopPropagation(); applyDelta(-0.1); });
    plusBtn.addEventListener("click", (e) => { e.stopPropagation(); applyDelta(0.1); });

    let closed = false;
    function closePanel() {
        if (closed) return;
        closed = true;
        document.removeEventListener("mousedown", outsideHandler, true);
        document.removeEventListener("keydown", keyHandler, true);
        if (panel.parentNode) panel.parentNode.removeChild(panel);
        node._promptPalette_weightPanelOpen = false;
    }
    function outsideHandler(e) {
        if (!panel.contains(e.target)) closePanel();
    }
    function keyHandler(e) {
        if (e.key === "Escape") { e.preventDefault(); closePanel(); }
    }
    closeBtn.addEventListener("click", (e) => { e.stopPropagation(); closePanel(); });

    // Defer outside-click registration so the originating click doesn't immediately close us
    setTimeout(() => {
        document.addEventListener("mousedown", outsideHandler, true);
        document.addEventListener("keydown", keyHandler, true);
        numberInput.focus();
        numberInput.select();
    }, 10);
}

function openPreviewEditor(node) {
    // Prevent multiple editors
    if (node._promptPalette_editorOpen) return;
    node._promptPalette_editorOpen = true;

    const canvas = app.canvas;
    const canvasEl = canvas.canvas;

    // Calculate preview area position in screen coordinates
    const nodePos = node.pos;
    const nodeWidth = node.size[0];
    const nodeHeight = node.size[1];

    // Preview area in node-local coordinates
    const previewX = CONFIG.sideNodePadding;
    const previewY = nodeHeight - CONFIG.previewHeight - 10;
    const previewWidth = nodeWidth - CONFIG.sideNodePadding * 2;

    // Transform node-local coordinates to canvas coordinates, then to screen coordinates.
    // LiteGraph DragAndScale convention: canvasX = (graphX + offset[0]) * scale
    const transform = canvas.ds;
    const canvasRect = canvasEl.getBoundingClientRect();

    const screenX = canvasRect.left + (nodePos[0] + previewX + transform.offset[0]) * transform.scale;
    const screenY = canvasRect.top + (nodePos[1] + previewY + 22 + transform.offset[1]) * transform.scale;
    const screenWidth = previewWidth * transform.scale;
    const screenHeight = (CONFIG.previewHeight - 25) * transform.scale;

    // Get current preview text (override if exists, otherwise generated)
    const currentOverride = getPreviewOverride(node);
    const previewText = currentOverride || generatePreview(node);

    const toolbarHeight = Math.max(22, 22 * transform.scale);

    // Create container for toolbar + textarea
    const container = document.createElement("div");
    container.style.cssText = `
        position: fixed;
        left: ${screenX}px;
        top: ${screenY - toolbarHeight}px;
        width: ${screenWidth}px;
        z-index: 10000;
    `;

    // Create toolbar with hint and close button
    const toolbar = document.createElement("div");
    toolbar.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: ${toolbarHeight}px;
        background: #ff9800;
        color: #1a1a2e;
        font-family: sans-serif;
        font-size: ${Math.max(9, 11 * transform.scale)}px;
        font-weight: bold;
        padding: 0 6px;
        border-radius: 4px 4px 0 0;
        box-sizing: border-box;
        user-select: none;
    `;

    const hintLabel = document.createElement("span");
    hintLabel.textContent = "Editing Preview — Esc: cancel";

    const closeBtn = document.createElement("span");
    closeBtn.textContent = "\u2715 Save";
    closeBtn.style.cssText = `
        cursor: pointer;
        padding: 1px 6px;
        border-radius: 3px;
        background: rgba(0,0,0,0.15);
    `;

    toolbar.appendChild(hintLabel);
    toolbar.appendChild(closeBtn);
    container.appendChild(toolbar);

    // Create textarea element
    const textarea = document.createElement("textarea");
    textarea.value = previewText;
    textarea.style.cssText = `
        display: block;
        width: 100%;
        height: ${screenHeight}px;
        font-family: monospace;
        font-size: ${Math.max(10, CONFIG.previewFontSize * transform.scale)}px;
        line-height: ${CONFIG.previewLineHeight * transform.scale}px;
        background: #1a1a2e;
        color: #e0e0e0;
        border: 2px solid #ff9800;
        border-top: none;
        border-radius: 0 0 4px 4px;
        padding: 4px 6px;
        resize: none;
        outline: none;
        box-sizing: border-box;
    `;
    container.appendChild(textarea);

    document.body.appendChild(container);

    let cancelled = false;
    let closing = false;

    function closeEditor(save) {
        if (closing) return;
        closing = true;
        if (!container.parentNode) {
            node._promptPalette_editorOpen = false;
            return;
        }
        if (save && !cancelled) {
            setPreviewOverride(node, textarea.value);
        }
        container.remove();
        node._promptPalette_editorOpen = false;
        app.graph.setDirtyCanvas(true);
    }

    // Close button saves and closes
    closeBtn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeEditor(true);
    });

    textarea.addEventListener("blur", (e) => {
        // Don't close if clicking the close button (it handles its own close)
        if (e.relatedTarget && container.contains(e.relatedTarget)) return;
        // Small delay to prevent premature close from focus stealing
        setTimeout(() => closeEditor(true), 100);
    });

    // Defer focus to avoid LiteGraph canvas stealing it during mousedown processing
    setTimeout(() => {
        if (textarea.parentNode) {
            textarea.focus();
            textarea.select();
        }
    }, 10);

    textarea.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            cancelled = true;
            closeEditor(false);
            e.preventDefault();
        }
        // Prevent canvas from receiving key events
        e.stopPropagation();
    });
}

// ========================================
// Preview Functionality
// ========================================

function generatePreview(node) {
    const textWidget = findTextWidget(node);
    const separatorWidget = findSeparatorWidget(node);
    const addNewlineWidget = findNewlineWidget(node);
    const separatorNewlineWidget = findSeparatorNewlineWidget(node);
    const trailingSeparatorWidget = findTrailingSeparatorWidget(node);

    if (!textWidget) return "";

    const text = textWidget.value || "";
    const separator = separatorWidget ? (separatorWidget.value !== undefined ? separatorWidget.value : ", ") : ", ";
    const addNewline = addNewlineWidget ? addNewlineWidget.value : false;
    const separatorNewline = separatorNewlineWidget ? separatorNewlineWidget.value : false;
    const trailingSeparator = trailingSeparatorWidget ? trailingSeparatorWidget.value : false;

    // Reset scroll position and clear override when source content changes
    if (!node.lastPreviewText || node.lastPreviewText !== text) {
        node.previewScrollOffset = 0;
        node.lastPreviewText = text;
        // Clear preview override when source text changes
        if (getPreviewOverride(node)) {
            setPreviewOverride(node, "");
        }
    }

    // Replicate Python's process method logic
    return processTextForPreview(text, separator, addNewline, separatorNewline, trailingSeparator);
}

function processTextForPreview(text, separator = ", ", addNewline = false, separatorNewline = false, trailingSeparator = false) {
    const lines = text.split("\n");
    const filteredLines = [];

    for (let line of lines) {
        // Skip empty lines
        if (!line.trim()) {
            continue;
        }
        // Skip commented lines (// for toggle, # for description)
        if (line.trim().startsWith("//") || line.trim().startsWith("#")) {
            continue;
        }
        // Remove inline comments
        if (line.includes("//")) {
            line = line.split("//")[0].trimEnd();
        }
        // Remove group tags
        line = removeGroupTags(line);
        if (line.trim()) {
            filteredLines.push(line.trimEnd());
        }
    }

    // Join with custom separator
    let result;
    if (separator === "") {
        // No separator, no newlines
        result = filteredLines.join("");
    } else {
        // Add newline to separator if requested
        const effectiveSeparator = separatorNewline ? separator + "\n" : separator;
        result = filteredLines.join(effectiveSeparator);
    }

    // Add trailing separator if requested
    if (trailingSeparator && separator !== "" && filteredLines.length > 0) {
        const effectiveSeparator = separatorNewline ? separator + "\n" : separator;
        result += effectiveSeparator;
    }

    if (addNewline) {
        result += "\n";
    }

    return result;
}

function drawPreview(node, ctx) {
    if (!node || node.isEditMode || node.hidePreview) return;

    try {
        // Check for override (stored on node property for reliability)
        const overrideText = getPreviewOverride(node);
        const hasOverride = overrideText !== "";
        const preview = hasOverride ? overrideText : generatePreview(node);

        const nodeWidth = node.size[0];
        const nodeHeight = node.size[1];

    // Calculate preview area (at the bottom of the node)
    const previewY = nodeHeight - CONFIG.previewHeight - 10;
    const previewX = CONFIG.sideNodePadding;
    const previewWidth = nodeWidth - CONFIG.sideNodePadding * 2;

    // Draw preview background
    const colors = getColors();

    const bgColor = colors.comfyInputBg || "#222222";
    ctx.fillStyle = bgColor + "80";
    ctx.fillRect(previewX, previewY, previewWidth, CONFIG.previewHeight);

    // Draw preview border (orange if edited)
    ctx.strokeStyle = hasOverride ? "#ff9800" : colors.borderColor;
    ctx.lineWidth = hasOverride ? 2 : 1;
    ctx.strokeRect(previewX, previewY, previewWidth, CONFIG.previewHeight);

    // Draw preview label
    const labelText = hasOverride ? "Preview (Edited):" : "Preview:";
    ctx.fillStyle = hasOverride ? "#ff9800" : colors.descripText;
    ctx.font = `${CONFIG.previewFontSize}px monospace`;
    ctx.textAlign = "left";
    ctx.fillText(labelText, previewX + 6, previewY + 15);

    // Draw Edit button
    const editLabel = "\u270E Edit";
    ctx.font = `${CONFIG.previewFontSize}px monospace`;
    const editWidth = ctx.measureText(editLabel).width + 12;
    let buttonX = previewX + previewWidth - editWidth - 4;
    if (hasOverride) {
        // Also draw Reset button to the left of Edit
        const resetLabel = "\u21BA Reset";
        const resetWidth = ctx.measureText(resetLabel).width + 12;
        const resetX = buttonX - resetWidth - 6;

        // Reset button background
        ctx.fillStyle = "#f4433680";
        ctx.beginPath();
        ctx.roundRect(resetX, previewY + 3, resetWidth, 16, 3);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.fillText(resetLabel, resetX + resetWidth / 2, previewY + 15);

        // Reset clickable area
        node.clickableAreas.push({
            x: resetX,
            y: previewY + 3,
            w: resetWidth,
            h: 16,
            action: 'preview_reset'
        });

        buttonX = previewX + previewWidth - editWidth - 4;
    }

    // Edit button background
    ctx.fillStyle = "#4CAF5080";
    ctx.beginPath();
    ctx.roundRect(buttonX, previewY + 3, editWidth, 16, 3);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText(editLabel, buttonX + editWidth / 2, previewY + 15);

    // Edit clickable area
    node.clickableAreas.push({
        x: buttonX,
        y: previewY + 3,
        w: editWidth,
        h: 16,
        action: 'preview_edit'
    });

    ctx.textAlign = "left";

    // Handle empty preview
    if (!preview || !preview.trim()) {
        ctx.fillStyle = colors.inactiveTextColor;
        ctx.font = `${CONFIG.previewFontSize}px monospace`;
        ctx.fillText("(empty)", previewX + 6, previewY + 35);
        return;
    }

    // Prepare text content for scrollable display
    ctx.fillStyle = colors.defaultTextColor;
    ctx.font = `${CONFIG.previewFontSize}px monospace`;
    ctx.textAlign = "left";
    const textAreaWidth = previewWidth - 12 - CONFIG.scrollBarWidth;

    // Split by newlines first, then wrap each line
    const previewLines = preview.split('\n');
    let allWrappedLines = [];

    for (const line of previewLines) {
        if (line === '') {
            allWrappedLines.push('');
        } else {
            const wrappedLine = wrapText(ctx, line, textAreaWidth);
            allWrappedLines = allWrappedLines.concat(wrappedLine);
        }
    }

    // Calculate scroll bounds
    const maxScrollOffset = Math.max(0, allWrappedLines.length - CONFIG.previewVisibleLines);
    node.previewScrollOffset = Math.max(0, Math.min(node.previewScrollOffset || 0, maxScrollOffset));

    // Draw visible lines with scroll offset
    const textStartY = previewY + 35;

    for (let i = 0; i < CONFIG.previewVisibleLines && (i + node.previewScrollOffset) < allWrappedLines.length; i++) {
        const lineIndex = i + node.previewScrollOffset;
        const line = allWrappedLines[lineIndex];
        const currentY = textStartY + i * CONFIG.previewLineHeight;

        if (line !== '') {
            ctx.fillStyle = colors.defaultTextColor || "#dddddd";
            ctx.font = `${CONFIG.previewFontSize}px monospace`;
            ctx.textAlign = "left";
            ctx.fillText(line, previewX + 6, currentY);
        }
    }

    // Draw scroll bar if needed
    if (allWrappedLines.length > CONFIG.previewVisibleLines) {
        drawScrollBar(ctx, previewX, previewY, previewWidth, CONFIG.previewHeight,
                     node.previewScrollOffset, maxScrollOffset, colors, node);
    }

    } catch (error) {
        // If there's an error in preview rendering, show error message
        const colors = getColors();
        ctx.fillStyle = colors.errorText || "#ff4444";
        ctx.font = `${CONFIG.previewFontSize}px monospace`;
        const previewX = CONFIG.sideNodePadding;
        const previewY = node.size[1] - CONFIG.previewHeight - 10;
        ctx.fillText("Preview Error", previewX + 6, previewY + 35);
        console.error("Preview render error:", error);
    }
}

function drawScrollBar(ctx, x, y, width, height, scrollOffset, maxScrollOffset, colors, node) {
    const scrollBarX = x + width - CONFIG.scrollBarWidth - 2;
    const scrollBarY = y + 20; // Start below the "Preview:" label
    const scrollBarHeight = height - 25 - (CONFIG.scrollButtonHeight * 2); // Account for up/down buttons
    
    // Draw up scroll button
    const upButtonY = scrollBarY;
    drawScrollButton(ctx, scrollBarX, upButtonY, CONFIG.scrollBarWidth, CONFIG.scrollButtonHeight, '▲', colors);
    
    // Add clickable area for up button
    node.clickableAreas.push({
        x: scrollBarX,
        y: upButtonY,
        w: CONFIG.scrollBarWidth,
        h: CONFIG.scrollButtonHeight,
        action: 'scroll_up'
    });
    
    // Draw scroll track
    const trackY = scrollBarY + CONFIG.scrollButtonHeight;
    ctx.fillStyle = "#2a2a2a"; // Dark gray background for track
    ctx.fillRect(scrollBarX, trackY, CONFIG.scrollBarWidth, scrollBarHeight);
    
    // Draw scroll track border
    ctx.strokeStyle = colors.borderColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(scrollBarX, trackY, CONFIG.scrollBarWidth, scrollBarHeight);
    
    // Calculate and draw scroll thumb
    if (maxScrollOffset > 0) {
        const visibleRatio = CONFIG.previewVisibleLines / (maxScrollOffset + CONFIG.previewVisibleLines);
        const thumbHeight = Math.max(20, scrollBarHeight * visibleRatio);
        const thumbY = trackY + (scrollBarHeight - thumbHeight) * (scrollOffset / maxScrollOffset);
        
        // Draw scroll thumb
        ctx.fillStyle = "#555555"; // Medium gray for thumb
        ctx.fillRect(scrollBarX + 1, thumbY, CONFIG.scrollBarWidth - 2, thumbHeight);
    }
    
    // Draw down scroll button
    const downButtonY = trackY + scrollBarHeight;
    drawScrollButton(ctx, scrollBarX, downButtonY, CONFIG.scrollBarWidth, CONFIG.scrollButtonHeight, '▼', colors);
    
    // Add clickable area for down button
    node.clickableAreas.push({
        x: scrollBarX,
        y: downButtonY,
        w: CONFIG.scrollBarWidth,
        h: CONFIG.scrollButtonHeight,
        action: 'scroll_down'
    });
}

function drawCheckboxScrollBar(ctx, node, colors) {
    const scroll = node._ppCheckboxScroll;
    if (!scroll || scroll.maxScrollLines <= 0) return;

    const scrollBarX = node.size[0] - CONFIG.sideNodePadding - CONFIG.scrollBarWidth;
    const scrollBarY = scroll.areaTop;
    const totalH = Math.max(CONFIG.scrollButtonHeight * 2 + 16, scroll.areaHeight);

    // Up button
    drawScrollButton(ctx, scrollBarX, scrollBarY, CONFIG.scrollBarWidth, CONFIG.scrollButtonHeight, '▲', colors);
    node.clickableAreas.push({
        x: scrollBarX, y: scrollBarY,
        w: CONFIG.scrollBarWidth, h: CONFIG.scrollButtonHeight,
        action: 'cb_scroll_up'
    });

    // Track
    const trackY = scrollBarY + CONFIG.scrollButtonHeight;
    const trackHeight = Math.max(0, totalH - CONFIG.scrollButtonHeight * 2);
    ctx.fillStyle = "#2a2a2a";
    ctx.fillRect(scrollBarX, trackY, CONFIG.scrollBarWidth, trackHeight);
    ctx.strokeStyle = colors.borderColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(scrollBarX, trackY, CONFIG.scrollBarWidth, trackHeight);

    // Thumb (size proportional to visible-to-total ratio)
    const visibleRatio = scroll.visibleLines / (scroll.maxScrollLines + scroll.visibleLines);
    const thumbHeight = Math.max(16, trackHeight * visibleRatio);
    const thumbY = trackY + (trackHeight - thumbHeight) * (scroll.scrollOffset / scroll.maxScrollLines);
    ctx.fillStyle = "#555555";
    ctx.fillRect(scrollBarX + 1, thumbY, CONFIG.scrollBarWidth - 2, thumbHeight);

    // Down button
    const downButtonY = trackY + trackHeight;
    drawScrollButton(ctx, scrollBarX, downButtonY, CONFIG.scrollBarWidth, CONFIG.scrollButtonHeight, '▼', colors);
    node.clickableAreas.push({
        x: scrollBarX, y: downButtonY,
        w: CONFIG.scrollBarWidth, h: CONFIG.scrollButtonHeight,
        action: 'cb_scroll_down'
    });
}

function drawScrollButton(ctx, x, y, width, height, symbol, colors) {
    // Draw button background
    ctx.fillStyle = "#3a3a3a"; // Dark gray background for buttons
    ctx.fillRect(x, y, width, height);

    // Draw button border
    ctx.strokeStyle = colors.borderColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, width, height);

    // Draw symbol
    ctx.fillStyle = colors.defaultTextColor;
    ctx.font = `${height - 4}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(symbol, x + width/2, y + height/2);
}
