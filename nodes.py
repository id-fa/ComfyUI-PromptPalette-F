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
                display_name="PromptPalette-F",
                category="utils",
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
    CATEGORY = "utils"

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


# V3 Extension entrypoint (only if V3 is available)
if V3_AVAILABLE:
    class PromptPaletteExtension(ComfyExtension):
        @property
        def web_directory(self):
            return os.path.join(os.path.dirname(os.path.realpath(__file__)), "web")

        async def get_node_list(self):
            return [PromptPalette_F]

    async def comfy_entrypoint():
        return PromptPaletteExtension()


# Legacy V1 exports for backward compatibility
NODE_CLASS_MAPPINGS = {"PromptPalette_F": PromptPalette_F}
NODE_DISPLAY_NAME_MAPPINGS = {"PromptPalette_F": "PromptPalette-F"}
WEB_DIRECTORY = os.path.join(os.path.dirname(os.path.realpath(__file__)), "web")
