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


class GemmaTranslate(BaseNodeClass):
    """Translate text with a Gemma4 text encoder loaded via CLIPLoader.

    Unlike "Prompt Tabs + Translate" (which translates instantly on a button
    click through the googletrans backend route), this node runs an actual LLM
    generation during graph execution. The CLIP it receives must be a Gemma4
    encoder loaded by a standard CLIPLoader (type ``gemma4``); the same
    ``clip.tokenize`` / ``clip.generate`` / ``clip.decode`` calls ComfyUI's own
    ``TextGenerate`` node uses are issued here with a translation instruction
    prompt. Because the model only lives inside the execution context, this node
    cannot translate on its own — it is meant to run as part of a (typically
    dedicated) workflow via Queue Prompt.

    The generated translation is returned on the ``translated`` output and also
    pushed to the frontend (``web/gemma_translate.js``) via the ``ui`` payload so
    it appears in the node's translated field. An optional ``unload_after``
    toggle frees the model from VRAM once the node finishes.
    """

    # UI choice -> language name embedded in the instruction prompt.
    _LANG_NAMES = {
        "English": "English",
        "Japanese": "Japanese",
        "Chinese": "Chinese (Simplified)",
    }

    if V3_AVAILABLE:
        @classmethod
        def define_schema(cls):
            return io.Schema(
                node_id="GemmaTranslate",
                display_name="Gemma Translate",
                category="Prompt Palette-F",
                inputs=[
                    io.Clip.Input("clip"),
                    io.String.Input("text", multiline=True, default=""),
                    io.Combo.Input(
                        "target_language",
                        options=["English", "Japanese", "Chinese"],
                        default="English",
                    ),
                    io.Int.Input("max_length", default=512, min=1, max=2048),
                    io.Boolean.Input("unload_after", default=False),
                ],
                outputs=[
                    io.String.Output(display_name="source"),
                    io.String.Output(display_name="translated"),
                ],
            )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "clip": ("CLIP", {
                    "tooltip": "A Gemma4 text encoder loaded by a CLIPLoader (type: gemma4). Place the model in ComfyUI/models/text_encoders/.",
                }),
                "text": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "tooltip": "Source text to translate.",
                }),
            },
            "optional": {
                # IMPORTANT: declare the combo as ("COMBO", {"options": [...]}),
                # NOT as a bare option list (["English", ...], {...}).
                # Because every node here subclasses io.ComfyNode, ComfyUI treats
                # them as V3 and runs the inputs through parse_class_inputs, which
                # does `value[0] in DYNAMIC_INPUT_LOOKUP` (a dict). A bare-list
                # combo makes value[0] the option LIST itself → "unhashable type:
                # 'list'" at prompt validation. The "COMBO" string keeps value[0]
                # hashable and moves the options into extra_info (read back via
                # io.Combo.io_type / extra_info["options"] during validation).
                "target_language": ("COMBO", {
                    "options": ["English", "Japanese", "Chinese"],
                    "default": "English",
                    "tooltip": "Language to translate the source text into.",
                }),
                "max_length": ("INT", {
                    "default": 512,
                    "min": 1,
                    "max": 2048,
                    "tooltip": "Maximum number of tokens to generate.",
                }),
                "unload_after": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "Unload all models from VRAM after translating. Useful for a dedicated translation-only workflow; affects the whole ComfyUI session's model cache.",
                }),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("source", "translated")
    FUNCTION = "execute"
    CATEGORY = "Prompt Palette-F"

    @staticmethod
    def _clean_translation(s):
        """Strip the chatter small instruction-tuned models tend to add around
        the actual translation: code fences, a leading 'Translation:' label, and
        matching surrounding quotes."""
        if not isinstance(s, str):
            return ""
        s = s.strip()
        # Surrounding ```...``` code fence (optionally language-tagged).
        if s.startswith("```"):
            s = re.sub(r"^```[a-zA-Z]*\n?", "", s)
            s = re.sub(r"\n?```$", "", s).strip()
        # Leading label like "Translation:" / "訳文：" / "翻訳結果:".
        s = re.sub(
            r"^(translation|translated text|translated|翻訳|訳文|翻訳結果)\s*[:：]\s*",
            "",
            s,
            flags=re.IGNORECASE,
        )
        # Matching surrounding quotes (ASCII or Japanese).
        if len(s) >= 2 and s[0] in "\"'「" and s[-1] in "\"'」":
            s = s[1:-1].strip()
        return s

    @classmethod
    def _generate(cls, clip, instruction, max_length):
        """Run the Gemma4 generation pipeline, mirroring ComfyUI's TextGenerate
        node. Falls back to a minimal call signature if the installed ComfyUI
        version's clip methods don't accept the extended keyword arguments."""
        try:
            tokens = clip.tokenize(
                instruction, skip_template=False, min_length=1, thinking=False
            )
        except TypeError:
            tokens = clip.tokenize(instruction)

        try:
            generated_ids = clip.generate(
                tokens,
                do_sample=False,
                max_length=int(max_length),
                temperature=0.7,
                top_k=40,
                top_p=0.9,
                min_p=0.0,
                repetition_penalty=1.0,
                presence_penalty=0.0,
                seed=0,
            )
        except TypeError:
            generated_ids = clip.generate(tokens, max_length=int(max_length))

        out = clip.decode(generated_ids)
        return out if isinstance(out, str) else str(out)

    @classmethod
    def _output(cls, source, translated):
        ui = {"translated": [translated]}
        if V3_AVAILABLE:
            return io.NodeOutput(source, translated, ui=ui)
        return {"ui": ui, "result": (source, translated)}

    @classmethod
    def execute(cls, clip, text="", target_language="English",
                max_length=512, unload_after=False):
        source = text if isinstance(text, str) else ""
        if not source.strip():
            return cls._output(source, "")

        lang = cls._LANG_NAMES.get(target_language, target_language or "English")
        instruction = (
            f"Translate the following text into {lang}. "
            f"Output only the translated text, with no explanations, notes, "
            f"labels, or quotation marks.\n\n"
            f"Text:\n{source}"
        )

        try:
            raw = cls._generate(clip, instruction, max_length)
            translated = cls._clean_translation(raw)
        except Exception as e:
            translated = f"[Gemma Translate error] {type(e).__name__}: {e}"

        if unload_after:
            try:
                import comfy.model_management as mm
                mm.unload_all_models()
                mm.soft_empty_cache()
            except Exception:
                pass

        return cls._output(source, translated)


class GemmaImagePrompt(BaseNodeClass):
    """Generate a text-to-image prompt from an input image (and/or instructions)
    using a Gemma4 vision-capable text encoder loaded via CLIPLoader.

    EXPERIMENTAL / test node. Like GemmaTranslate it runs a real Gemma4 LLM
    generation during graph execution (the same clip.tokenize / clip.generate /
    clip.decode pipeline as ComfyUI's built-in TextGenerate node), but here the
    image is fed to the multimodal tokenizer (clip.tokenize(..., image=image)) so
    Gemma can "look at" it. The node asks the model to describe how to recreate a
    visually similar image while honoring the user's modification instructions,
    and to emit ONLY the prompt in a `POSITIVE:` / `NEGATIVE:` form that is parsed
    into the two outputs.

    The request prompt is adjusted by four settings: free-form modification
    instructions, output style (natural language vs comma-separated Danbooru
    tags), target model (FLUX vs SDXL — affects whether a negative prompt is
    produced), and whether to keep changes minimal or expand the scene with extra
    detail. With no image wired, the prompt is built from the instruction text
    alone. Cannot run standalone (needs a loaded CLIP). Own frontend
    (web/gemma_image_prompt.js, native widgets only) shows the two results.
    Gemma-4-E4B may not fully follow every instruction — this is a test node.
    """

    if V3_AVAILABLE:
        @classmethod
        def define_schema(cls):
            return io.Schema(
                node_id="GemmaImagePrompt",
                display_name="Gemma Image Prompt",
                category="Prompt Palette-F",
                inputs=[
                    io.Clip.Input("clip"),
                    io.Image.Input("image", optional=True),
                    io.String.Input("instruction", multiline=True, default=""),
                    io.Combo.Input(
                        "output_format",
                        options=["Natural language", "Danbooru tags"],
                        default="Natural language",
                    ),
                    io.Combo.Input(
                        "target_model",
                        options=["FLUX", "SDXL"],
                        default="FLUX",
                    ),
                    io.Combo.Input(
                        "detail_mode",
                        options=["Keep as instructed", "Expand detail"],
                        default="Keep as instructed",
                    ),
                    io.Int.Input("max_length", default=512, min=1, max=2048),
                    io.Boolean.Input("unload_after", default=False),
                    io.Combo.Input(
                        "prompt_mode",
                        options=[
                            "Generate (recreate image)",
                            "Edit instruction (change description)",
                            "Video description (LTXV)",
                        ],
                        default="Generate (recreate image)",
                    ),
                    # Appended last (after prompt_mode) to keep widgets_values
                    # index-stable for workflows saved before these existed.
                    io.Image.Input("video", optional=True),
                    io.Int.Input("max_frames", default=8, min=1, max=64),
                ],
                outputs=[
                    io.String.Output(display_name="positive"),
                    io.String.Output(display_name="negative"),
                ],
            )

    @classmethod
    def INPUT_TYPES(cls):
        # NOTE: combos use the ("COMBO", {"options": [...]}) form, NOT a bare
        # option list — every node here subclasses io.ComfyNode, so a bare-list
        # combo crashes V3 prompt validation with "unhashable type: 'list'".
        return {
            "required": {
                "clip": ("CLIP", {
                    "tooltip": "A Gemma4 text encoder loaded by a CLIPLoader (type: gemma4). Must be a vision-capable Gemma4 build to use the image input.",
                }),
            },
            "optional": {
                "image": ("IMAGE", {
                    "tooltip": "Image to analyze. When connected, Gemma describes how to recreate a similar image. When NOT connected, the prompt is built from the instruction text alone.",
                }),
                "instruction": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "tooltip": "Free-form modification instructions (e.g. 'make it night time, add rain'). Applied on top of the image analysis.",
                }),
                "output_format": ("COMBO", {
                    "options": ["Natural language", "Danbooru tags"],
                    "default": "Natural language",
                    "tooltip": "Output style: fluent natural-language sentences, or a comma-separated list of Danbooru-style tags.",
                }),
                "target_model": ("COMBO", {
                    "options": ["FLUX", "SDXL"],
                    "default": "FLUX",
                    "tooltip": "Intended generation model. FLUX → natural language, negative prompt kept empty. SDXL → also produces a negative prompt.",
                }),
                "detail_mode": ("COMBO", {
                    "options": ["Keep as instructed", "Expand detail"],
                    "default": "Keep as instructed",
                    "tooltip": "Keep as instructed: change only what's requested, add nothing. Expand detail: enrich the scene with extra fitting objects/details.",
                }),
                "max_length": ("INT", {
                    "default": 512,
                    "min": 1,
                    "max": 2048,
                    "tooltip": "Maximum number of tokens to generate.",
                }),
                "unload_after": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "Unload all models from VRAM after running. Affects the whole ComfyUI session's model cache (default OFF).",
                }),
                # Appended last to keep widgets_values index-stable for workflows
                # saved before this option existed.
                "prompt_mode": ("COMBO", {
                    "options": [
                        "Generate (recreate image)",
                        "Edit instruction (change description)",
                        "Video description (LTXV)",
                    ],
                    "default": "Generate (recreate image)",
                    "tooltip": "Generate: a text-to-image prompt that recreates a similar image. Edit instruction: a 'change X into Y' editing instruction for image-editing models (e.g. Qwen-Image-Edit) that states both the original element and what it becomes, not just the final result. Video description (LTXV): a single flowing text-to-video prompt (present tense, camera moves, chronological motion) for LTX-2 / LTXV — pair it with the video input.",
                }),
                # Video content prompt generation. Appended after prompt_mode so
                # existing saves keep their widget/slot indices. In ComfyUI a
                # "video" is an IMAGE batch of frames (e.g. from VHS Load Video);
                # Gemma4's tokenizer has a native video= path, Qwen3-VL falls back
                # to treating the frames as multiple stills.
                "video": ("IMAGE", {
                    "tooltip": "Video frames to analyze (an IMAGE batch, e.g. from a Load Video node). When connected, use prompt_mode 'Video description (LTXV)' to describe the motion/scene for a text-to-video model.",
                }),
                "max_frames": ("INT", {
                    "default": 8,
                    "min": 1,
                    "max": 64,
                    "tooltip": "Maximum number of frames uniformly sampled from the video before sending to the model (caps VRAM/context; especially important for Qwen3-VL, which treats every frame as a separate still).",
                }),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("positive", "negative")
    FUNCTION = "execute"
    CATEGORY = "Prompt Palette-F"

    @classmethod
    def _build_request(cls, instruction, image_present, output_format,
                       target_model, detail_mode, prompt_mode,
                       video_present=False):
        """Assemble the instruction prompt sent to Gemma, adjusted by settings.

        Three modes:
        - Generate: write a text-to-image prompt that recreates a similar image.
        - Edit instruction: write a 'change X into Y' editing instruction for an
          image-editing model (e.g. Qwen-Image-Edit), stating both the original
          element and what it becomes (not just the final result).
        - Video description (LTXV): write a single flowing text-to-video prompt
          (present tense, camera moves, chronological motion) for LTX-2 / LTXV."""
        mode = prompt_mode.lower() if isinstance(prompt_mode, str) else ""
        is_video = "video" in mode
        is_edit = (not is_video) and "edit" in mode
        media_present = image_present or video_present

        if is_video:
            return cls._build_video_request(
                instruction, image_present, video_present, detail_mode)

        lines = [
            "You are an expert prompt engineer for text-to-image diffusion models."
        ]

        if is_edit:
            # --- Edit-instruction mode (for image-editing models) ---
            if image_present:
                lines.append(
                    "Look carefully at the provided image and write an EDITING "
                    "INSTRUCTION for an image-editing model (e.g. Qwen-Image-Edit) "
                    "that transforms this image as requested below."
                )
            else:
                lines.append(
                    "Write an EDITING INSTRUCTION for an image-editing model based "
                    "solely on the user's request below."
                )
            lines.append(
                "Describe the change explicitly: state BOTH the original element "
                "and what it should become (e.g. 'change the red car into a blue "
                "sports car', 'replace the daytime sky with a starry night sky', "
                "'add a cat sitting on the sofa'). Do NOT merely describe the final "
                "image — phrase it as an instruction of what to change from the "
                "original."
            )
            lines.append(
                "Write the instruction as concise natural-language sentences, not "
                "a tag list."
            )
            lines.append(
                "Image-editing models are instruction-based and do not use a "
                "negative prompt — leave the negative prompt empty."
            )
        else:
            # --- Generation mode (text-to-image) ---
            if image_present:
                lines.append(
                    "Look carefully at the provided image and write a prompt that "
                    "would generate a NEW image visually similar to it (same "
                    "subject, composition, style, colors and mood)."
                )
            else:
                lines.append(
                    "Write a text-to-image prompt based solely on the user's "
                    "request below."
                )

            if output_format == "Danbooru tags":
                lines.append(
                    "Write the prompt as a comma-separated list of Danbooru-style "
                    "tags (lowercase, words joined by underscores), ordered from "
                    "most to least important."
                )
            else:
                lines.append(
                    "Write the prompt as fluent, descriptive natural-language "
                    "sentences."
                )

            if target_model == "SDXL":
                lines.append(
                    "The target model is SDXL. Also provide a concise negative "
                    "prompt listing things to avoid (e.g. low quality, blurry, bad "
                    "anatomy, extra fingers, watermark)."
                )
            else:
                lines.append(
                    "The target model is FLUX, which works best with descriptive "
                    "language and does NOT use a negative prompt — leave the "
                    "negative prompt empty."
                )

        if detail_mode == "Expand detail":
            if is_edit:
                lines.append(
                    "Beyond the requested change, add a few complementary edits "
                    "that fit the scene naturally."
                )
            else:
                lines.append(
                    "Beyond any requested changes, enrich the scene with additional "
                    "fitting details and extra objects to make the image more "
                    "elaborate."
                )
        else:
            faithful = " while staying faithful to the source image" if image_present else ""
            lines.append(
                "Apply ONLY the changes explicitly requested" + faithful +
                ". Do not invent or add new objects that were not requested."
            )

        instr = instruction.strip() if isinstance(instruction, str) else ""
        if instr:
            label = "User's requested edit" if is_edit else "User's modification request"
            lines.append(f"{label}: {instr}")
        elif image_present and not is_edit:
            lines.append("No specific changes requested — recreate the image faithfully.")

        lines.append(
            "Output ONLY the prompt — no explanations, no commentary, no markdown, "
            "no code fences. Respond in EXACTLY this format and nothing else:\n"
            "POSITIVE: <the positive prompt>\n"
            "NEGATIVE: <the negative prompt, or leave blank>"
        )
        return "\n".join(lines)

    @classmethod
    def _build_video_request(cls, instruction, image_present, video_present,
                             detail_mode):
        """Assemble an LTX-2 / LTXV-style text-to-video request prompt.

        LTX-2 prompts work best as a single flowing paragraph in the present
        tense, describing the literal chronological motion, explicit camera
        work, and the scene (shot type, lighting, color, texture, atmosphere).
        Video models are prompted with positive description only, so the
        negative prompt is left empty."""
        lines = [
            "You are an expert prompt engineer for text-to-video diffusion "
            "models such as LTX-2 / LTXV."
        ]

        if video_present:
            lines.append(
                "Watch the provided video carefully and write a prompt that "
                "describes what happens in it so a text-to-video model can "
                "recreate a visually and temporally similar clip."
            )
        elif image_present:
            lines.append(
                "Look at the provided image and write a text-to-video prompt "
                "that brings the scene to life with plausible, natural motion."
            )
        else:
            lines.append(
                "Write a text-to-video prompt based solely on the user's "
                "request below."
            )

        lines.append(
            "Write ONE flowing paragraph of 4 to 8 sentences in the present "
            "tense. Do NOT use a comma-separated tag list."
        )
        lines.append(
            "Describe, in chronological order, the literal motion of the "
            "subjects and how the scene changes over time (e.g. 'she shifts her "
            "weight to her left foot and turns her head slowly toward the "
            "camera'), not abstract impressions."
        )
        lines.append(
            "Explicitly describe the camera work with cinematography language "
            "(for example: static frame, pans across, tracks, follows, pushes "
            "in, pulls back, tilts up, circles around, handheld, overhead view) "
            "and state when the view shifts and how the subject looks after the "
            "move."
        )
        lines.append(
            "Set the scene with the shot type/scale, lighting, color palette, "
            "surface textures, and atmosphere."
        )
        lines.append(
            "Text-to-video models are prompted with positive description only "
            "— leave the negative prompt empty."
        )

        if detail_mode == "Expand detail":
            lines.append(
                "Enrich the clip with additional fitting background action and "
                "secondary motion to make it more dynamic and cinematic."
            )
        else:
            faithful = " while staying faithful to the source" if (
                video_present or image_present) else ""
            lines.append(
                "Keep the motion and scene grounded in what is shown or "
                "requested" + faithful +
                "; do not invent unrelated events."
            )

        instr = instruction.strip() if isinstance(instruction, str) else ""
        if instr:
            lines.append(f"User's requested motion/scene: {instr}")
        elif video_present:
            lines.append(
                "No specific changes requested — describe the video's motion "
                "and scene faithfully."
            )

        lines.append(
            "Output ONLY the prompt — no explanations, no commentary, no "
            "markdown, no code fences. Respond in EXACTLY this format and "
            "nothing else:\n"
            "POSITIVE: <the positive prompt>\n"
            "NEGATIVE: <leave blank>"
        )
        return "\n".join(lines)

    @staticmethod
    def _clean(s):
        """Strip code fences and matching surrounding quotes from one field."""
        if not isinstance(s, str):
            return ""
        s = s.strip()
        if s.startswith("```"):
            s = re.sub(r"^```[a-zA-Z]*\n?", "", s)
            s = re.sub(r"\n?```$", "", s).strip()
        if len(s) >= 2 and s[0] in "\"'「" and s[-1] in "\"'」":
            s = s[1:-1].strip()
        return s

    # Placeholders a model may emit for "no negative prompt".
    _EMPTY_NEG = {"", "(empty)", "empty", "none", "(none)", "n/a", "na", "-", "null"}

    @classmethod
    def _parse_pos_neg(cls, text):
        """Pull POSITIVE / NEGATIVE sections out of the generated text. Falls back
        to treating the whole output as the positive prompt if the labels are
        missing."""
        if not isinstance(text, str):
            return "", ""
        s = text.strip()
        if s.startswith("```"):
            s = re.sub(r"^```[a-zA-Z]*\n?", "", s)
            s = re.sub(r"\n?```$", "", s).strip()

        pos_match = re.search(
            r"POSITIVE\s*[:：]\s*(.*?)(?=\n\s*NEGATIVE\s*[:：]|$)",
            s, re.IGNORECASE | re.DOTALL,
        )
        neg_match = re.search(
            r"NEGATIVE\s*[:：]\s*(.*)$", s, re.IGNORECASE | re.DOTALL,
        )
        if pos_match:
            positive = pos_match.group(1).strip()
            negative = neg_match.group(1).strip() if neg_match else ""
        else:
            positive = s
            negative = ""

        positive = cls._clean(positive)
        negative = cls._clean(negative)
        if negative.lower() in cls._EMPTY_NEG:
            negative = ""
        return positive, negative

    @staticmethod
    def _tokenizer_accepts(clip, name):
        """True if the underlying tokenizer's tokenize_with_weights declares an
        explicit parameter called `name` (e.g. Gemma4 has a real `video=`).
        Used so we don't hand `video=` to a tokenizer that would silently drop
        it into **kwargs (e.g. Qwen3-VL, which only understands image=)."""
        try:
            import inspect
            fn = clip.tokenizer.tokenize_with_weights
            return name in inspect.signature(fn).parameters
        except Exception:
            return False

    @staticmethod
    def _sample_frames(video, max_frames):
        """Uniformly sample at most max_frames frames from an IMAGE batch tensor
        (shape [frames, H, W, C]). Caps VRAM/context before the frames reach the
        model. Defensive: returns the input unchanged if it isn't an indexable
        batch (so plain sentinels used in tests pass straight through)."""
        try:
            n = int(video.shape[0])
        except Exception:
            return video
        try:
            m = max(1, int(max_frames))
        except Exception:
            m = 8
        if n <= m:
            return video
        step = n / float(m)
        idx = [min(n - 1, int(i * step)) for i in range(m)]
        try:
            return video[idx]
        except Exception:
            return video

    @classmethod
    def _tokenize_visual(cls, clip, prompt, key, media):
        """Tokenize with a single visual kwarg (`image` or `video`), with a
        TypeError fallback to a minimal signature for older ComfyUI builds."""
        kwargs = {key: media}
        try:
            return clip.tokenize(
                prompt, skip_template=False, min_length=1, thinking=False,
                **kwargs,
            )
        except TypeError:
            return clip.tokenize(prompt, **kwargs)

    @classmethod
    def _generate(cls, clip, prompt, image, video, max_length):
        """Run Gemma generation, passing the visual input to the multimodal
        tokenizer when present. Video (an IMAGE batch of frames) is sent through
        the tokenizer's native video= path when the tokenizer supports it
        (Gemma4), otherwise as image= (Qwen3-VL splits the batch into per-frame
        stills). Video takes precedence over a still image when both are wired.
        Each call has a TypeError fallback to a minimal signature for older
        ComfyUI builds."""
        if video is not None:
            key = "video" if cls._tokenizer_accepts(clip, "video") else "image"
            tokens = cls._tokenize_visual(clip, prompt, key, video)
        elif image is not None:
            tokens = cls._tokenize_visual(clip, prompt, "image", image)
        else:
            try:
                tokens = clip.tokenize(
                    prompt, skip_template=False, min_length=1, thinking=False,
                )
            except TypeError:
                tokens = clip.tokenize(prompt)

        try:
            generated_ids = clip.generate(
                tokens,
                do_sample=False,
                max_length=int(max_length),
                temperature=0.7,
                top_k=40,
                top_p=0.9,
                min_p=0.0,
                repetition_penalty=1.0,
                presence_penalty=0.0,
                seed=0,
            )
        except TypeError:
            generated_ids = clip.generate(tokens, max_length=int(max_length))

        out = clip.decode(generated_ids)
        return out if isinstance(out, str) else str(out)

    @classmethod
    def _output(cls, positive, negative):
        ui = {"positive": [positive], "negative": [negative]}
        if V3_AVAILABLE:
            return io.NodeOutput(positive, negative, ui=ui)
        return {"ui": ui, "result": (positive, negative)}

    @classmethod
    def execute(cls, clip, image=None, instruction="",
                output_format="Natural language", target_model="FLUX",
                detail_mode="Keep as instructed", max_length=512,
                unload_after=False, prompt_mode="Generate (recreate image)",
                video=None, max_frames=8):
        image_present = image is not None
        video_present = video is not None
        instr = instruction if isinstance(instruction, str) else ""

        # Nothing to work with: no image, no video AND no instruction text.
        if not image_present and not video_present and not instr.strip():
            return cls._output("", "")

        request = cls._build_request(
            instr, image_present, output_format, target_model, detail_mode,
            prompt_mode, video_present=video_present,
        )

        try:
            sampled_video = (
                cls._sample_frames(video, max_frames) if video_present else None
            )
            raw = cls._generate(
                clip, request,
                image if image_present else None,
                sampled_video, max_length,
            )
            positive, negative = cls._parse_pos_neg(raw)
        except Exception as e:
            positive = f"[Gemma Image Prompt error] {type(e).__name__}: {e}"
            negative = ""

        if unload_after:
            try:
                import comfy.model_management as mm
                mm.unload_all_models()
                mm.soft_empty_cache()
            except Exception:
                pass

        return cls._output(positive, negative)


# ---------------------------------------------------------------------------
# Translation backend for the "Prompt Tabs + Translate" node.
#
# Exposes POST /promptpalette_f/translate so the frontend can translate on
# button click (immediately, not only at queue time). Translation is handled by
# the `googletrans` library (see requirements.txt); no API key is required.
# On failure (library missing, runtime/network error) it raises
# _PPFTranslateError with a clear, user-facing message; the route turns that
# into a JSON {"error": ...} response so the UI can show why nothing happened
# instead of silently returning an empty translation.
# ---------------------------------------------------------------------------

# Map the UI's target codes to what each backend expects.
_PPF_LANG_ALIASES = {
    "ja": "ja",
    "en": "en",
    "zh": "zh-cn",
    "zh-cn": "zh-cn",
    "zh-CN": "zh-cn",
}


class _PPFTranslateError(Exception):
    """Translation could not be performed. Carries a clear, user-facing message
    (shown by the frontend as "翻訳失敗: <message>")."""
    pass


# Shown when the googletrans library can't be imported. Kept here so the message
# is easy to find/edit; it tells the user exactly how to fix it.
_PPF_GOOGLETRANS_MISSING_MSG = (
    "googletrans がインストールされていません。ComfyUI の Python 環境で "
    "`pip install googletrans` を実行して ComfyUI を再起動してください "
    "(requirements.txt 参照) / googletrans is not installed. Run "
    "`pip install googletrans` in ComfyUI's Python environment and restart."
)


async def _ppf_aclose_translator(translator):
    """Best-effort close of googletrans 4.x's underlying httpx AsyncClient.
    Prevents 'coroutine AsyncClient.get was never awaited' warnings when a
    translate call fails partway through. No-op for sync versions."""
    client = getattr(translator, "client", None)
    aclose = getattr(client, "aclose", None)
    if aclose is None:
        return
    try:
        result = aclose()
        import inspect as _inspect
        if _inspect.isawaitable(result):
            await result
    except Exception:
        pass


async def _ppf_googletrans_translate(text, target):
    """Translate via googletrans. Raises _PPFTranslateError with a clear,
    user-facing message if the library is missing or the call fails."""
    try:
        from googletrans import Translator
    except ImportError:
        raise _PPFTranslateError(_PPF_GOOGLETRANS_MISSING_MSG)
    except Exception as e:
        # A broken install (e.g. incompatible httpx) can fail at import time
        # with something other than ImportError — surface it clearly too.
        raise _PPFTranslateError(
            f"googletrans の読み込みに失敗しました / failed to load googletrans: {e}"
        )

    import inspect as _inspect
    translator = Translator()
    try:
        result = translator.translate(text, dest=target)
        # googletrans 4.x's Translator.translate may be a coroutine (httpx-based)
        # or a plain object depending on the installed version.
        if _inspect.isawaitable(result):
            result = await result
        out = getattr(result, "text", None)
        if not isinstance(out, str):
            raise _PPFTranslateError(
                "googletrans から翻訳結果が得られませんでした "
                "/ googletrans returned no text."
            )
        return out
    except _PPFTranslateError:
        raise
    except Exception as e:
        raise _PPFTranslateError(
            f"googletrans の実行に失敗しました / googletrans failed "
            f"({type(e).__name__}): {e}"
        )
    finally:
        await _ppf_aclose_translator(translator)


async def _ppf_translate_text(text, target):
    text = text if isinstance(text, str) else ""
    if not text.strip():
        return ""
    target = _PPF_LANG_ALIASES.get(target, target or "en")
    # Translation is handled entirely by googletrans. Failures raise
    # _PPFTranslateError, which the route turns into a JSON error response.
    return await _ppf_googletrans_translate(text, target)


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
            return [PromptPalette_F, SimpleMultiConcatText, GetFirstWord, GetFirstWordList, PromptTabs, PromptTabsTranslate, NodeValueTemplate, GemmaTranslate, GemmaImagePrompt]

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
    "GemmaTranslate": GemmaTranslate,
    "GemmaImagePrompt": GemmaImagePrompt,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "PromptPalette_F": "PromptPalette-F",
    "SimpleMultiConcatText": "Simple Multi Concat Text",
    "GetFirstWord": "Get First Word",
    "GetFirstWordList": "Get First Word (List)",
    "PromptTabs": "Prompt Tabs",
    "PromptTabsTranslate": "Prompt Tabs + Translate",
    "NodeValueTemplate": "Node Value Template",
    "GemmaTranslate": "Gemma Translate",
    "GemmaImagePrompt": "Gemma Image Prompt",
}
WEB_DIRECTORY = os.path.join(os.path.dirname(os.path.realpath(__file__)), "web")
