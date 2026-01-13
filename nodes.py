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
    BaseNodeClassV1Only = object  # For nodes that don't support V3
else:
    BaseNodeClass = object
    BaseNodeClassV1Only = object


class PromptPalette_F(BaseNodeClass):
    """Classic mode PromptPalette-F node with canvas-based UI"""

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
                        "prefix",
                        optional=True,
                        force_input=True
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
                ],
                outputs=[io.String.Output()]
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
                "prefix": ("STRING", {"forceInput": True}),
                "separator": ("STRING", {"default": ", "}),
                "trailing_separator": ("BOOLEAN", {"default": False}),
                "separator_newline": ("BOOLEAN", {"default": False}),
                "add_newline": ("BOOLEAN", {"default": False}),
            },
        }

    RETURN_TYPES = ("STRING",)
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

    @classmethod
    def execute(cls, text, prefix=None, separator=", ", add_newline=False,
                separator_newline=False, trailing_separator=False):
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

        # Join with custom separator
        if separator == "":
            # No separator, no newlines
            result = "".join(filtered_lines)
        else:
            # Add newline to separator if requested
            effective_separator = separator + "\n" if separator_newline else separator
            result = effective_separator.join(filtered_lines)

        if prefix:
            if separator == "":
                result = prefix + result
            else:
                # Use the same effective separator for prefix
                effective_separator = separator + "\n" if separator_newline else separator
                result = prefix + effective_separator + result

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
            return io.NodeOutput(result)
        else:
            return (result,)


class PromptPalette_F_Vue(BaseNodeClassV1Only):
    """Nodes 2.0 PromptPalette-F node with Vue.js-based UI"""

    # This node uses V1 API only (not V3) because custom widget types
    # are not well supported in V3 API's define_schema()

    # V1 API INPUT_TYPES (always available)
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt_palette_data": ("PROMPT_PALETTE_VUE", {}),
            },
        }

    RETURN_TYPES = ("STRING",)
    FUNCTION = "execute"
    CATEGORY = "utils"
    OUTPUT_NODE = False

    @classmethod
    def execute(cls, prompt_palette_data):
        """Execute with data from Vue widget"""
        # Debug: Log received data
        print(f"[PromptPalette_F_Vue] execute called")
        print(f"[PromptPalette_F_Vue] Received data type: {type(prompt_palette_data)}")
        print(f"[PromptPalette_F_Vue] Received data: {prompt_palette_data}")

        # Extract data from Vue widget
        if isinstance(prompt_palette_data, dict):
            text = prompt_palette_data.get("text", "")
            separator = prompt_palette_data.get("separator", ", ")
            print(f"[PromptPalette_F_Vue] Extracted text (first 50 chars): {text[:50]}")
            print(f"[PromptPalette_F_Vue] Extracted separator: '{separator}'")
        else:
            # Fallback for simple string input
            text = str(prompt_palette_data)
            separator = ", "
            print(f"[PromptPalette_F_Vue] Using fallback string: {text[:50]}")

        # Process text
        lines = text.split("\n")
        filtered_lines = []
        for line in lines:
            if not line.strip():
                continue
            if line.strip().startswith("//") or line.strip().startswith("#"):
                continue
            if "//" in line:
                line = line.split("//")[0].rstrip()
            line = PromptPalette_F.remove_group_tags_with_escape(line)
            if line:
                filtered_lines.append(line)

        result = separator.join(filtered_lines)

        if V3_AVAILABLE:
            return io.NodeOutput(result)
        else:
            return (result,)


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
NODE_CLASS_MAPPINGS = {
    "PromptPalette_F": PromptPalette_F,
    "PromptPalette_F_Vue": PromptPalette_F_Vue
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "PromptPalette_F": "PromptPalette-F",
    "PromptPalette_F_Vue": "PromptPalette-F (Vue)"
}
WEB_DIRECTORY = os.path.join(os.path.dirname(os.path.realpath(__file__)), "web")
