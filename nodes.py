import json
import os
import re

# Try V3 API imports (optional)
try:
    from comfy_api.latest import io, ComfyExtension
    V3_AVAILABLE = True
except ImportError:
    V3_AVAILABLE = False
    # Dummy classes for V1 compatibility
    class ComfyNode:
        pass

# Define base class based on API availability
if V3_AVAILABLE:
    BaseNodeClass = io.ComfyNode
else:
    BaseNodeClass = object


class PromptPalette_F(BaseNodeClass):
    # V3 API Schema (only if V3 is available)
    if V3_AVAILABLE:
        @classmethod
        def define_schema(cls):
            return io.Schema(
                node_id="PromptPalette_F",
                display_name="Prompt Palette-F",
                category="Prompt Palette-F",
                inputs=[
                    io.String.Input(
                        "text",
                        default="",
                        multiline=True
                    ),
                    io.String.Input(
                        "separator",
                        default=", "
                    ),
                    io.Boolean.Input(
                        "trailing_separator",
                        default=False
                    ),
                    io.Boolean.Input(
                        "separator_newline",
                        default=False
                    ),
                    io.Boolean.Input(
                        "add_newline",
                        default=False
                    ),
                    io.String.Input(
                        "preview_override",
                        optional=True,
                        default=""
                    ),
                    io.String.Input(
                        "prefix",
                        optional=True,
                        default="",
                        multiline=True
                    ),
                    io.Boolean.Input(
                        "prefix_separator",
                        default=False
                    ),
                    io.Boolean.Input(
                        "empty_when_no_selection",
                        default=False
                    ),
                ],
                outputs=[
                    io.String.Output(display_name="text"),
                    io.String.Output(display_name="selected_text"),
                    io.String.Output(display_name="selected_list"),
                ]
            )

    # V1 API INPUT_TYPES (always available)
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": (
                    "STRING",
                    {"default": "", "multiline": True},
                )
            },
            "optional": {
                "separator": ("STRING", {
                    "default": ", ",
                    "tooltip": "Separator used to join selected phrases (default: \", \"). Use empty string for no separator.",
                }),
                "trailing_separator": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "Append the separator after the last phrase too.",
                }),
                "separator_newline": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "Append a newline after each separator (one phrase per line in output).",
                }),
                "add_newline": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "Append a newline at the very end of the output.",
                }),
                "preview_override": ("STRING", {"default": ""}),
                "prefix": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "tooltip": "Text prepended before the joined body. Useful for chaining multiple nodes.",
                }),
                "prefix_separator": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "Insert the separator between prefix and body. OFF = plain prefix+body concat.",
                }),
                "empty_when_no_selection": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "When no phrase is selected, output Python None on all three outputs (no prefix, no newline). Targets switches like rgthree Any Switch that check `value is None` to route to another input.",
                }),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "LIST")
    RETURN_NAMES = ("text", "selected_text", "selected_list")
    FUNCTION = "execute"
    CATEGORY = "Prompt Palette-F"

    @staticmethod
    def remove_group_tags_with_escape(line):
        """Remove group tags [group] while preserving escaped brackets \[ \]"""
        # 1. Replace escaped brackets with placeholders
        line = line.replace(r'\[', '___ESC_OPEN___')
        line = line.replace(r'\]', '___ESC_CLOSE___')

        # 2. Remove group tags
        line = re.sub(r'\s*\[[^\]]+\]', '', line)

        # 3. Restore escaped brackets as literal brackets
        line = line.replace('___ESC_OPEN___', '[')
        line = line.replace('___ESC_CLOSE___', ']')

        return line.strip()

    @staticmethod
    def strip_weight_notation(phrase):
        """Strip weight notation: (text:1.5) -> text. Handles nested parens by
        repeatedly unwrapping outermost (...:number). Plain parens like (text)
        without a numeric weight are left intact."""
        prev = None
        current = phrase.strip()
        while prev != current:
            prev = current
            m = re.fullmatch(r'\(\s*(.+?)\s*:\s*-?\d*\.?\d+\s*\)', current)
            if m:
                current = m.group(1).strip()
        return current

    @classmethod
    def execute(cls, text, prefix="", separator=", ", add_newline=False,
                separator_newline=False, trailing_separator=False,
                preview_override="", prefix_separator=False,
                empty_when_no_selection=False):
        # Defensive coercion: prefix can occasionally arrive as a non-string
        # (e.g. boolean False from a widget whose value got out of sync, or
        # from an older save where a BOOLEAN widget occupied this input
        # position). Without this guard, str(False) would yield "False" and
        # it would be prepended to the output.
        if not isinstance(prefix, str):
            prefix = ""

        lines = text.split("\n")
        filtered_lines = []
        for line in lines:
            # Skip empty lines
            if not line.strip():
                continue
            # Skip commented lines (// for toggle, # for description)
            if line.strip().startswith("//") or line.strip().startswith("#"):
                continue
            # Remove inline comments
            if "//" in line:
                line = line.split("//")[0].rstrip()
            # Remove group tags [group] from line with escape support
            line = cls.remove_group_tags_with_escape(line)
            if line:  # Only add non-empty lines after tag removal
                filtered_lines.append(line)

        # Build the selected-words list (weights stripped).
        # This output reflects the actual selection regardless of
        # prefix/separator/preview_override settings.
        selected_list = [cls.strip_weight_notation(p) for p in filtered_lines]
        selected_list = [p for p in selected_list if p]
        selected_text = "\n".join(selected_list)

        # If preview_override is set, the main text output uses the override
        # directly (temporary edit). The list outputs still reflect the real
        # selection so downstream nodes can keep using them.
        # preview_override always wins over empty_when_no_selection — if the
        # user has explicitly edited preview content, that's their intent.
        if preview_override:
            if V3_AVAILABLE:
                return io.NodeOutput(preview_override, selected_text, selected_list)
            else:
                return (preview_override, selected_text, selected_list)

        # Empty-selection short-circuit: when the user enables
        # `empty_when_no_selection` and no phrase survived filtering (no
        # `//`-active line), emit Python None on every output. This is
        # the value that switch / router nodes (e.g. rgthree's Any Switch,
        # which does `value is None`) treat as "skip this input". The
        # downstream execution still RUNS (unlike ExecutionBlocker) so
        # individual switch/conditional nodes can decide what to do —
        # they typically pass through the next non-None input.
        # NOTE: downstream nodes that don't handle None gracefully may
        # error on this value. Users connecting to such nodes should keep
        # the toggle OFF, or insert a switch/None-handler in between.
        if empty_when_no_selection and not filtered_lines:
            if V3_AVAILABLE:
                return io.NodeOutput(None, None, None)
            else:
                return (None, None, None)

        # Join with custom separator
        if separator == "":
            # No separator, no newlines
            result = "".join(filtered_lines)
        else:
            # Add newline to separator if requested
            effective_separator = separator + "\n" if separator_newline else separator
            result = effective_separator.join(filtered_lines)

        if prefix:
            # Only insert separator between prefix and content when explicitly
            # requested AND both sides have content; otherwise plain concat.
            if prefix_separator and separator != "" and filtered_lines:
                effective_separator = separator + "\n" if separator_newline else separator
                result = prefix + effective_separator + result
            else:
                result = prefix + result

        # Add trailing separator if requested
        if trailing_separator and separator != "" and filtered_lines:
            effective_separator = separator + "\n" if separator_newline else separator
            if add_newline:
                # Add trailing separator before the final newline
                result += effective_separator
            else:
                result += effective_separator

        if add_newline:
            result += "\n"

        # Return format depends on API version
        if V3_AVAILABLE:
            return io.NodeOutput(result, selected_text, selected_list)
        else:
            return (result, selected_text, selected_list)


class SimpleMultiConcatText(BaseNodeClass):
    """Concatenate up to 5 text inputs with an optional separator. UI-less utility."""

    if V3_AVAILABLE:
        @classmethod
        def define_schema(cls):
            return io.Schema(
                node_id="SimpleMultiConcatText",
                display_name="Simple Multi Concat Text",
                category="Prompt Palette-F",
                inputs=[
                    io.String.Input("text1", optional=True, default=""),
                    io.String.Input("text2", optional=True, default=""),
                    io.String.Input("text3", optional=True, default=""),
                    io.String.Input("text4", optional=True, default=""),
                    io.String.Input("text5", optional=True, default=""),
                    io.String.Input("separator", default=""),
                    io.Boolean.Input("separator_newline", default=False),
                    io.Boolean.Input("add_newline", default=False),
                ],
                outputs=[
                    io.String.Output(display_name="text"),
                ],
            )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "text1": ("STRING", {"forceInput": True}),
                "text2": ("STRING", {"forceInput": True}),
                "text3": ("STRING", {"forceInput": True}),
                "text4": ("STRING", {"forceInput": True}),
                "text5": ("STRING", {"forceInput": True}),
                "separator": ("STRING", {
                    "default": "",
                    "tooltip": "Separator inserted between non-empty inputs (default: empty string).",
                }),
                "separator_newline": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "Append a newline after each separator.",
                }),
                "add_newline": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "Append a newline at the end of the output. Skipped when there are no non-empty inputs.",
                }),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "execute"
    CATEGORY = "Prompt Palette-F"

    @classmethod
    def execute(cls, text1="", text2="", text3="", text4="", text5="",
                separator="", separator_newline=False, add_newline=False):
        raw_inputs = [text1, text2, text3, text4, text5]
        # Coerce non-string / None to "" so unconnected slots don't break us.
        valid_inputs = [t for t in raw_inputs if isinstance(t, str) and t != ""]

        if not isinstance(separator, str):
            separator = ""

        # separator_newline appends a newline to the separator. When separator
        # is empty AND separator_newline is on, the effective separator becomes
        # a bare "\n" so inputs are joined line-by-line.
        effective_separator = separator + "\n" if separator_newline else separator
        result = effective_separator.join(valid_inputs)

        if add_newline and valid_inputs:
            result += "\n"

        if V3_AVAILABLE:
            return io.NodeOutput(result)
        else:
            return (result,)


class GetFirstWord(BaseNodeClass):
    """Return the portion of text before the first occurrence of stop_word. UI-less utility."""

    # Windows-invalid filename characters: <>:"/\|?* and control chars 0x00-0x1F.
    _WINDOWS_INVALID_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')

    if V3_AVAILABLE:
        @classmethod
        def define_schema(cls):
            return io.Schema(
                node_id="GetFirstWord",
                display_name="Get First Word",
                category="Prompt Palette-F",
                inputs=[
                    io.String.Input("text", optional=True, default=""),
                    io.String.Input("stop_word", default=","),
                    io.Boolean.Input("use_regex", default=False),
                    io.Boolean.Input("trim", default=True),
                    io.Boolean.Input("remove_invalid_filename_chars", default=False),
                    io.Boolean.Input("add_trailing_slash", default=False),
                ],
                outputs=[
                    io.String.Output(display_name="text"),
                ],
            )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "text": ("STRING", {"forceInput": True}),
                "stop_word": ("STRING", {
                    "default": ",",
                    "tooltip": "Output everything before the first occurrence of this string (default: comma). Escape sequences \\n, \\r, \\t are expanded so newlines/tabs can be typed in the single-line widget. When use_regex is ON, this is interpreted as a regular expression instead and escape expansion is skipped.",
                }),
                "use_regex": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "Interpret stop_word as a regular expression. Invalid patterns fall through (return the whole text). When ON, escape expansion is skipped — write \\n / \\t directly in the regex.",
                }),
                "trim": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "Strip leading/trailing whitespace and newlines from the result.",
                }),
                "remove_invalid_filename_chars": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "Remove characters Windows forbids in filenames: <>:\"/\\|?* and control chars, plus trailing dots/spaces.",
                }),
                "add_trailing_slash": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "Append a / to use the result as a folder path. Skipped when the result is empty.",
                }),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "execute"
    CATEGORY = "Prompt Palette-F"

    @classmethod
    def process_one(cls, text, stop_word, use_regex, trim,
                    remove_invalid_filename_chars, add_trailing_slash):
        """Core transform — shared with GetFirstWordList. Returns a string."""
        if not isinstance(text, str):
            text = ""
        if not isinstance(stop_word, str):
            stop_word = ","

        if use_regex:
            # Regex mode: don't pre-expand escapes — \n / \t / \r are valid regex
            # syntax and will be interpreted by `re` itself. Invalid patterns
            # fall through to "return the whole text" instead of erroring.
            if stop_word != "":
                try:
                    m = re.search(stop_word, text)
                    result = text[:m.start()] if m else text
                except re.error:
                    result = text
            else:
                result = text
        else:
            # Literal mode: expand common escape sequences so a single-line widget
            # can specify newline/tab/CR as the stop_word by typing \n / \r / \t.
            # Wire-connected stop_word values that already contain real newlines
            # are unaffected (no \n substring to replace).
            stop_word = stop_word.replace("\\n", "\n").replace("\\r", "\r").replace("\\t", "\t")
            # Split by stop_word; an empty stop_word would raise ValueError on str.split,
            # so fall through to the whole text in that case.
            if stop_word != "":
                result = text.split(stop_word, 1)[0]
            else:
                result = text

        if trim:
            result = result.strip()

        if remove_invalid_filename_chars:
            result = cls._WINDOWS_INVALID_CHARS.sub("", result)
            # Windows also forbids trailing dots and spaces in filenames.
            result = result.rstrip(". ")

        if add_trailing_slash and result != "":
            result += "/"

        return result

    @classmethod
    def execute(cls, text="", stop_word=",", use_regex=False, trim=True,
                remove_invalid_filename_chars=False, add_trailing_slash=False):
        result = cls.process_one(
            text, stop_word, use_regex, trim,
            remove_invalid_filename_chars, add_trailing_slash,
        )
        if V3_AVAILABLE:
            return io.NodeOutput(result)
        else:
            return (result,)


class GetFirstWordList(BaseNodeClass):
    """Apply Get First Word to every item in a LIST input. UI-less utility."""

    if V3_AVAILABLE:
        @classmethod
        def define_schema(cls):
            return io.Schema(
                node_id="GetFirstWordList",
                display_name="Get First Word (List)",
                category="Prompt Palette-F",
                inputs=[
                    # V3 has no first-class LIST input — declare String here
                    # and rely on V1 INPUT_TYPES "LIST" for the real slot type.
                    # ComfyUI passes the actual Python list at execute time.
                    io.String.Input("items", optional=True),
                    io.String.Input("stop_word", default=","),
                    io.Boolean.Input("use_regex", default=False),
                    io.Boolean.Input("trim", default=True),
                    io.Boolean.Input("remove_invalid_filename_chars", default=False),
                    io.Boolean.Input("add_trailing_slash", default=False),
                    io.String.Input("text_separator", default=", "),
                ],
                outputs=[
                    io.String.Output(display_name="text"),
                    io.String.Output(display_name="list"),
                ],
            )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "items": ("LIST", {"forceInput": True}),
                "stop_word": ("STRING", {
                    "default": ",",
                    "tooltip": "Same semantics as Get First Word's stop_word. Escape sequences \\n, \\r, \\t are expanded when use_regex is OFF.",
                }),
                "use_regex": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "Interpret stop_word as a regular expression. Invalid patterns fall through (return the item as-is).",
                }),
                "trim": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "Strip leading/trailing whitespace and newlines from each result.",
                }),
                "remove_invalid_filename_chars": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "Remove Windows-forbidden filename characters (<>:\"/\\|?* and control chars, plus trailing dots/spaces) from each result.",
                }),
                "add_trailing_slash": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "Append / to non-empty results.",
                }),
                "text_separator": ("STRING", {
                    "default": ", ",
                    "tooltip": "Separator used to join all results into the `text` output. The `list` output is unaffected.",
                }),
            },
        }

    RETURN_TYPES = ("STRING", "LIST")
    RETURN_NAMES = ("text", "list")
    FUNCTION = "execute"
    CATEGORY = "Prompt Palette-F"

    @classmethod
    def execute(cls, items=None, stop_word=",", use_regex=False, trim=True,
                remove_invalid_filename_chars=False, add_trailing_slash=False,
                text_separator=", "):
        # Defensive coercion: an unconnected slot or a wrong-typed upstream
        # shouldn't crash the node. Accept list/tuple/set as list-like; treat
        # a bare string as a single-item list; anything else becomes empty.
        if items is None:
            items = []
        elif isinstance(items, (tuple, set)):
            items = list(items)
        elif isinstance(items, str):
            items = [items] if items else []
        elif not isinstance(items, list):
            items = []

        if not isinstance(text_separator, str):
            text_separator = ", "

        results = []
        for item in items:
            if item is None:
                continue
            text = item if isinstance(item, str) else str(item)
            results.append(GetFirstWord.process_one(
                text, stop_word, use_regex, trim,
                remove_invalid_filename_chars, add_trailing_slash,
            ))

        text_out = text_separator.join(results)

        if V3_AVAILABLE:
            return io.NodeOutput(text_out, results)
        else:
            return (text_out, results)


class PromptTabs(BaseNodeClass):
    """Notepad-style node holding any number of named prompt tabs.

    The visible ``text`` widget is the editor for the active tab; ``tabs_data``
    is a hidden JSON store managed entirely by ``web/prompt_tabs.js`` holding
    ``{"tabs": [{"name", "text"}], "active": int}``. Python emits whatever the
    active editor currently holds plus the active tab's name, so the node
    degrades to a plain text box (with an empty label) if the frontend
    extension fails to load. Do not move tab-selection logic into Python —
    ``_active_label`` only reads the name the frontend already chose.
    """

    if V3_AVAILABLE:
        @classmethod
        def define_schema(cls):
            return io.Schema(
                node_id="PromptTabs",
                display_name="Prompt Tabs",
                category="Prompt Palette-F",
                inputs=[
                    io.String.Input(
                        "text",
                        multiline=True,
                        default="",
                        tooltip="Text of the currently selected tab.",
                    ),
                    io.String.Input(
                        "tabs_data",
                        default="",
                        tooltip="Internal tab storage (managed by the UI).",
                    ),
                ],
                outputs=[
                    io.String.Output(display_name="text"),
                    io.String.Output(display_name="label"),
                ],
            )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # Editor for the active tab. The frontend swaps its contents
                # when you switch tabs; its value at run time IS the output.
                "text": ("STRING", {
                    "multiline": True,
                    "default": "",
                    "tooltip": "Text of the currently selected tab.",
                }),
                # Master store for every tab. Hidden and driven entirely by
                # web/prompt_tabs.js. Holds JSON: {"tabs": [{"name", "text"}],
                # "active": int}. Not meant to be edited by hand.
                "tabs_data": ("STRING", {
                    "default": "",
                    "tooltip": "Internal tab storage (managed by the UI).",
                }),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("text", "label")
    FUNCTION = "execute"
    CATEGORY = "Prompt Palette-F"

    @staticmethod
    def _active_label(tabs_data):
        # Pull the active tab's name out of the JSON the frontend maintains.
        # Any malformed/missing data degrades to an empty label.
        try:
            data = json.loads(tabs_data) if tabs_data else None
        except (ValueError, TypeError):
            return ""
        if not isinstance(data, dict):
            return ""
        tabs = data.get("tabs")
        active = data.get("active", 0)
        if not isinstance(tabs, list) or not isinstance(active, int):
            return ""
        if not (0 <= active < len(tabs)):
            return ""
        name = tabs[active].get("name") if isinstance(tabs[active], dict) else None
        return name if isinstance(name, str) else ""

    @classmethod
    def execute(cls, text="", tabs_data=""):
        label = cls._active_label(tabs_data)
        if V3_AVAILABLE:
            return io.NodeOutput(text, label)
        else:
            return (text, label)


class NodeValueTemplate(BaseNodeClass):
    """Output a string with %NodeTitle.widget% tokens resolved from other nodes.

    Mirrors ComfyUI's SaveImage ``filename_prefix`` substitution
    (``%KSampler.seed%`` style): the visible ``template`` widget keeps the raw
    ``%Title.widget%`` text, while the frontend (``web/node_value_template.js``)
    resolves every token against the current graph at queue time and injects
    the resolved string into the prompt before it reaches the backend.

    Resolution MUST happen in the frontend because node titles and live widget
    values only exist there (the backend prompt carries node ids + input values,
    not titles). Python therefore only passes the ``template`` through; if the
    frontend extension fails to load, the node degrades to emitting the raw
    template (tokens left intact) instead of crashing.
    """

    if V3_AVAILABLE:
        @classmethod
        def define_schema(cls):
            return io.Schema(
                node_id="NodeValueTemplate",
                display_name="Node Value Template",
                category="Prompt Palette-F",
                inputs=[
                    io.String.Input(
                        "template",
                        default="",
                        multiline=True,
                    ),
                ],
                outputs=[
                    io.String.Output(display_name="text"),
                ],
            )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "template": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "tooltip": (
                        "Text with %NodeTitle.widget% tokens. Each token is "
                        "replaced by the current value of the named widget on "
                        "the node whose title matches NodeTitle, like "
                        "SaveImage's filename_prefix. Resolved in the frontend "
                        "at queue time; unresolvable tokens are left as-is."
                    ),
                }),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "execute"
    CATEGORY = "Prompt Palette-F"

    @classmethod
    def execute(cls, template=""):
        # The frontend has already replaced %Title.widget% tokens in the value
        # that reaches us, so this is a straight pass-through. Coerce non-string
        # values defensively (a wrong-typed widget shouldn't crash the node).
        if not isinstance(template, str):
            template = ""
        if V3_AVAILABLE:
            return io.NodeOutput(template)
        else:
            return (template,)


class PromptTabsTranslate(BaseNodeClass):
    """Prompt Tabs variant with a per-tab source + translated text pair.

    Each tab holds two independently-editable fields — ``source`` (the original
    prompt) and ``translated`` (its translation) — stored in the hidden
    ``tabs_data`` JSON managed by ``web/prompt_tabs_translate.js`` as
    ``{"tabs": [{"name", "source", "translated"}], "active": int}``. The visible
    ``text`` / ``translated`` widgets are the editors for the active tab.

    Translation itself runs in the frontend on button click via the
    ``/promptpalette_f/translate`` server route below (so it happens immediately,
    not only at queue time). Python only passes the active editors through plus
    the active tab's name, so the node degrades to two plain text boxes if the
    frontend extension fails to load. Do not move tab-selection or translation
    logic into ``execute`` — it only reads what the frontend already chose.
    """

    if V3_AVAILABLE:
        @classmethod
        def define_schema(cls):
            return io.Schema(
                node_id="PromptTabsTranslate",
                display_name="Prompt Tabs + Translate",
                category="Prompt Palette-F",
                inputs=[
                    io.String.Input(
                        "text",
                        multiline=True,
                        default="",
                        tooltip="Source text of the currently selected tab.",
                    ),
                    io.String.Input(
                        "translated",
                        multiline=True,
                        default="",
                        tooltip="Translated text of the currently selected tab (freely editable).",
                    ),
                    io.String.Input(
                        "tabs_data",
                        default="",
                        tooltip="Internal tab storage (managed by the UI).",
                    ),
                ],
                outputs=[
                    io.String.Output(display_name="source"),
                    io.String.Output(display_name="translated"),
                    io.String.Output(display_name="label"),
                ],
            )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {
                    "multiline": True,
                    "default": "",
                    "tooltip": "Source text of the currently selected tab.",
                }),
                "translated": ("STRING", {
                    "multiline": True,
                    "default": "",
                    "tooltip": "Translated text of the currently selected tab (freely editable).",
                }),
                "tabs_data": ("STRING", {
                    "default": "",
                    "tooltip": "Internal tab storage (managed by the UI).",
                }),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING")
    RETURN_NAMES = ("source", "translated", "label")
    FUNCTION = "execute"
    CATEGORY = "Prompt Palette-F"

    @staticmethod
    def _active_label(tabs_data):
        # Pull the active tab's name out of the JSON the frontend maintains.
        # Any malformed/missing data degrades to an empty label.
        try:
            data = json.loads(tabs_data) if tabs_data else None
        except (ValueError, TypeError):
            return ""
        if not isinstance(data, dict):
            return ""
        tabs = data.get("tabs")
        active = data.get("active", 0)
        if not isinstance(tabs, list) or not isinstance(active, int):
            return ""
        if not (0 <= active < len(tabs)):
            return ""
        name = tabs[active].get("name") if isinstance(tabs[active], dict) else None
        return name if isinstance(name, str) else ""

    @classmethod
    def execute(cls, text="", translated="", tabs_data=""):
        if not isinstance(text, str):
            text = ""
        if not isinstance(translated, str):
            translated = ""
        label = cls._active_label(tabs_data)
        if V3_AVAILABLE:
            return io.NodeOutput(text, translated, label)
        else:
            return (text, translated, label)


# ---------------------------------------------------------------------------
# Translation backend for the "Prompt Tabs + Translate" node.
#
# Exposes POST /promptpalette_f/translate so the frontend can translate on
# button click (immediately, not only at queue time). Translation needs no API
# key: it prefers the optional `googletrans` library if installed, otherwise it
# falls back to Google's free translate web endpoint via aiohttp (which ComfyUI
# already ships). Both paths are best-effort and never raise to the caller.
# ---------------------------------------------------------------------------

# Map the UI's target codes to what each backend expects.
_PPF_LANG_ALIASES = {
    "ja": "ja",
    "en": "en",
    "zh": "zh-cn",
    "zh-cn": "zh-cn",
    "zh-CN": "zh-cn",
}


async def _ppf_try_googletrans(text, target):
    """Translate via the optional googletrans library. Returns None if the
    library is missing or fails, so the caller can fall back."""
    try:
        from googletrans import Translator
    except Exception:
        return None
    try:
        import inspect as _inspect
        translator = Translator()
        result = translator.translate(text, dest=target)
        # googletrans 4.x's Translator.translate may be a coroutine (httpx-based)
        # or a plain object depending on the installed version.
        if _inspect.isawaitable(result):
            result = await result
        out = getattr(result, "text", None)
        return out if isinstance(out, str) else None
    except Exception:
        return None


async def _ppf_translate_via_endpoint(text, target):
    """Fallback translation using Google's free translate web endpoint.
    No API key required. Returns "" on failure."""
    import aiohttp
    url = "https://translate.googleapis.com/translate_a/single"
    params = {
        "client": "gtx",
        "sl": "auto",
        "tl": target,
        "dt": "t",
        "q": text,
    }
    try:
        timeout = aiohttp.ClientTimeout(total=20)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url, params=params) as resp:
                # Google returns JSON but sometimes with a text/* content type.
                data = await resp.json(content_type=None)
    except Exception:
        return ""
    # Response shape: [[["translated chunk","original chunk", ...], ...], ...]
    parts = []
    if isinstance(data, list) and data and isinstance(data[0], list):
        for seg in data[0]:
            if isinstance(seg, list) and seg and isinstance(seg[0], str):
                parts.append(seg[0])
    return "".join(parts)


async def _ppf_translate_text(text, target):
    text = text if isinstance(text, str) else ""
    if not text.strip():
        return ""
    target = _PPF_LANG_ALIASES.get(target, target or "en")
    # Prefer googletrans when available; fall back to the free endpoint.
    via_lib = await _ppf_try_googletrans(text, target)
    if via_lib is not None:
        return via_lib
    return await _ppf_translate_via_endpoint(text, target)


# Register the route once. Guarded so a missing server / double import never
# breaks node loading.
try:
    from server import PromptServer
    from aiohttp import web as _ppf_web

    _ppf_server = PromptServer.instance
    if _ppf_server is not None and not getattr(_ppf_server, "_ppf_translate_registered", False):
        @_ppf_server.routes.post("/promptpalette_f/translate")
        async def _ppf_translate_route(request):
            try:
                data = await request.json()
            except Exception:
                data = {}
            text = data.get("text", "") if isinstance(data, dict) else ""
            target = data.get("target", "en") if isinstance(data, dict) else "en"
            try:
                translated = await _ppf_translate_text(text, target or "en")
                return _ppf_web.json_response({"translated": translated})
            except Exception as e:
                return _ppf_web.json_response({"error": str(e)}, status=500)

        _ppf_server._ppf_translate_registered = True
except Exception:
    # No server context (e.g. unit import) — the node still loads; translation
    # just won't be available until ComfyUI's server is running.
    pass


# V3 Extension entrypoint (only if V3 is available)
if V3_AVAILABLE:
    class PromptPaletteExtension(ComfyExtension):
        @property
        def web_directory(self):
            return os.path.join(os.path.dirname(os.path.realpath(__file__)), "web")

        async def get_node_list(self):
            return [PromptPalette_F, SimpleMultiConcatText, GetFirstWord, GetFirstWordList, PromptTabs, PromptTabsTranslate, NodeValueTemplate]

    async def comfy_entrypoint():
        return PromptPaletteExtension()


# Legacy V1 exports for backward compatibility
NODE_CLASS_MAPPINGS = {
    "PromptPalette_F": PromptPalette_F,
    "SimpleMultiConcatText": SimpleMultiConcatText,
    "GetFirstWord": GetFirstWord,
    "GetFirstWordList": GetFirstWordList,
    "PromptTabs": PromptTabs,
    "PromptTabsTranslate": PromptTabsTranslate,
    "NodeValueTemplate": NodeValueTemplate,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "PromptPalette_F": "PromptPalette-F",
    "SimpleMultiConcatText": "Simple Multi Concat Text",
    "GetFirstWord": "Get First Word",
    "GetFirstWordList": "Get First Word (List)",
    "PromptTabs": "Prompt Tabs",
    "PromptTabsTranslate": "Prompt Tabs + Translate",
    "NodeValueTemplate": "Node Value Template",
}
WEB_DIRECTORY = os.path.join(os.path.dirname(os.path.realpath(__file__)), "web")
