import os
import re


class PromptPalette_F:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "text": (
                    "STRING",
                    {"default": "", "multiline": True, "rows": 8},
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
    FUNCTION = "process"
    CATEGORY = "utils"

    def remove_group_tags_with_escape(self, line):
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

    def process(self, text, prefix=None, separator=", ", add_newline=False, separator_newline=False, trailing_separator=False):
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
            line = self.remove_group_tags_with_escape(line)
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

        return (result,)


NODE_CLASS_MAPPINGS = {"PromptPalette_F": PromptPalette_F}
NODE_DISPLAY_NAME_MAPPINGS = {"PromptPalette_F": "PromptPalette-F"}
WEB_DIRECTORY = os.path.join(os.path.dirname(os.path.realpath(__file__)), "web")
