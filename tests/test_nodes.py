"""Backend unit tests for ComfyUI-PromptPalette-F.

These run WITHOUT a ComfyUI server. nodes.py imports cleanly standalone:
`comfy_api.latest` is optional (V3_AVAILABLE becomes False), and the
translate route registration is guarded by try/except. In this mode every
node's execute() returns a plain tuple (the V1 format), which is what we
assert against here.

Run from the repo root:

    python -m unittest discover -s tests -v
"""

import os
import sys
import unittest

# Make the repo root importable so `import nodes` works from anywhere.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import nodes  # noqa: E402
from nodes import (  # noqa: E402
    PromptPalette_F,
    SimpleMultiConcatText,
    GetFirstWord,
    GetFirstWordList,
    PromptTabs,
    PromptTabsTranslate,
    NodeValueTemplate,
)


class TestStandaloneImport(unittest.TestCase):
    def test_runs_in_v1_mode(self):
        # The whole point: these tests exercise the V1 (tuple) return path.
        self.assertFalse(nodes.V3_AVAILABLE)

    def test_all_nodes_registered(self):
        self.assertEqual(
            set(nodes.NODE_CLASS_MAPPINGS),
            {
                "PromptPalette_F", "SimpleMultiConcatText", "GetFirstWord",
                "GetFirstWordList", "PromptTabs", "PromptTabsTranslate",
                "NodeValueTemplate",
            },
        )

    def test_display_names_cover_all_classes(self):
        self.assertEqual(
            set(nodes.NODE_CLASS_MAPPINGS),
            set(nodes.NODE_DISPLAY_NAME_MAPPINGS),
        )


class TestPromptPaletteF(unittest.TestCase):
    def test_basic_join(self):
        text, selected_text, selected_list = PromptPalette_F.execute(
            "a\nb\nc", separator=", ")
        self.assertEqual(text, "a, b, c")
        self.assertEqual(selected_text, "a\nb\nc")
        self.assertEqual(selected_list, ["a", "b", "c"])

    def test_toggle_comment_filtered(self):
        text, _, lst = PromptPalette_F.execute("a\n//b\nc", separator=", ")
        self.assertEqual(text, "a, c")
        self.assertEqual(lst, ["a", "c"])

    def test_description_comment_filtered(self):
        text, _, _ = PromptPalette_F.execute("# note\na", separator=", ")
        self.assertEqual(text, "a")

    def test_inline_comment_stripped(self):
        text, _, _ = PromptPalette_F.execute("a // inline\nb", separator=", ")
        self.assertEqual(text, "a, b")

    def test_empty_lines_skipped(self):
        text, _, _ = PromptPalette_F.execute("a\n\n\nb", separator=", ")
        self.assertEqual(text, "a, b")

    def test_empty_separator_no_spacing(self):
        text, _, _ = PromptPalette_F.execute("a\nb", separator="")
        self.assertEqual(text, "ab")

    def test_separator_newline(self):
        text, _, _ = PromptPalette_F.execute(
            "a\nb", separator=",", separator_newline=True)
        self.assertEqual(text, "a,\nb")

    def test_trailing_separator(self):
        text, _, _ = PromptPalette_F.execute(
            "a\nb", separator=", ", trailing_separator=True)
        self.assertEqual(text, "a, b, ")

    def test_add_newline(self):
        text, _, _ = PromptPalette_F.execute("a\nb", separator=", ", add_newline=True)
        self.assertEqual(text, "a, b\n")

    def test_group_tags_removed(self):
        text, _, lst = PromptPalette_F.execute("cat [animals]\ndog [animals]")
        self.assertEqual(text, "cat, dog")
        self.assertEqual(lst, ["cat", "dog"])

    def test_escaped_brackets_preserved(self):
        text, _, _ = PromptPalette_F.execute(r"foo \[literal\] [grp]")
        self.assertEqual(text, "foo [literal]")

    def test_prefix_plain_concat(self):
        text, _, _ = PromptPalette_F.execute("a\nb", prefix="P:", separator=", ")
        self.assertEqual(text, "P:a, b")

    def test_prefix_with_separator(self):
        text, _, _ = PromptPalette_F.execute(
            "a\nb", prefix="P", separator=", ", prefix_separator=True)
        self.assertEqual(text, "P, a, b")

    def test_prefix_non_string_coerced(self):
        # A boolean leaking into prefix must not become "False".
        text, _, _ = PromptPalette_F.execute("a", prefix=False, separator=", ")  # type: ignore[arg-type]
        self.assertEqual(text, "a")

    def test_weight_stripped_in_list_outputs_only(self):
        text, selected_text, lst = PromptPalette_F.execute("(cat:1.5)\ndog")
        # main text keeps the weight notation
        self.assertEqual(text, "(cat:1.5), dog")
        # list outputs are clean
        self.assertEqual(lst, ["cat", "dog"])
        self.assertEqual(selected_text, "cat\ndog")

    def test_preview_override_wins_for_text_only(self):
        text, selected_text, lst = PromptPalette_F.execute(
            "a\nb", preview_override="OVERRIDE")
        self.assertEqual(text, "OVERRIDE")
        # list outputs still reflect the real selection
        self.assertEqual(lst, ["a", "b"])
        self.assertEqual(selected_text, "a\nb")

    def test_empty_when_no_selection_returns_none(self):
        result = PromptPalette_F.execute("//a\n//b", empty_when_no_selection=True)
        self.assertEqual(result, (None, None, None))

    def test_empty_when_no_selection_off_returns_empty_string(self):
        text, selected_text, lst = PromptPalette_F.execute(
            "//a", empty_when_no_selection=False)
        self.assertEqual(text, "")
        self.assertEqual(lst, [])

    def test_preview_override_beats_empty_toggle(self):
        text, _, _ = PromptPalette_F.execute(
            "//a", preview_override="X", empty_when_no_selection=True)
        self.assertEqual(text, "X")


class TestStripWeightNotation(unittest.TestCase):
    def test_simple(self):
        self.assertEqual(PromptPalette_F.strip_weight_notation("(cat:1.5)"), "cat")

    def test_nested(self):
        self.assertEqual(PromptPalette_F.strip_weight_notation("((a:1.2):1.5)"), "a")

    def test_plain_parens_untouched(self):
        self.assertEqual(PromptPalette_F.strip_weight_notation("(cat)"), "(cat)")

    def test_negative_weight(self):
        self.assertEqual(PromptPalette_F.strip_weight_notation("(a:-1.0)"), "a")

    def test_no_weight(self):
        self.assertEqual(PromptPalette_F.strip_weight_notation("plain"), "plain")


class TestSimpleMultiConcatText(unittest.TestCase):
    def test_basic(self):
        (out,) = SimpleMultiConcatText.execute(text1="a", text2="b", separator=", ")
        self.assertEqual(out, "a, b")

    def test_empty_inputs_filtered(self):
        (out,) = SimpleMultiConcatText.execute(
            text1="a", text2="", text3="c", separator=",")
        self.assertEqual(out, "a,c")

    def test_none_inputs_filtered(self):
        (out,) = SimpleMultiConcatText.execute(text1="a", text2=None, separator=",")  # type: ignore[arg-type]
        self.assertEqual(out, "a")

    def test_separator_newline_with_empty_separator(self):
        (out,) = SimpleMultiConcatText.execute(
            text1="a", text2="b", separator="", separator_newline=True)
        self.assertEqual(out, "a\nb")

    def test_add_newline_skipped_when_no_inputs(self):
        (out,) = SimpleMultiConcatText.execute(add_newline=True)
        self.assertEqual(out, "")

    def test_add_newline_applied(self):
        (out,) = SimpleMultiConcatText.execute(text1="a", add_newline=True)
        self.assertEqual(out, "a\n")


class TestGetFirstWord(unittest.TestCase):
    def test_literal_split(self):
        (out,) = GetFirstWord.execute(text="hello, world", stop_word=",")
        self.assertEqual(out, "hello")

    def test_empty_stop_word_returns_whole(self):
        (out,) = GetFirstWord.execute(text="hello world", stop_word="")
        self.assertEqual(out, "hello world")

    def test_literal_escape_expansion(self):
        (out,) = GetFirstWord.execute(text="a\nb", stop_word="\\n")
        self.assertEqual(out, "a")

    def test_regex_mode(self):
        (out,) = GetFirstWord.execute(text="abc123def", stop_word=r"\d+", use_regex=True)
        self.assertEqual(out, "abc")

    def test_regex_invalid_falls_through(self):
        (out,) = GetFirstWord.execute(text="abc", stop_word="[", use_regex=True)
        self.assertEqual(out, "abc")

    def test_trim(self):
        (out,) = GetFirstWord.execute(text="  hi  , x", stop_word=",", trim=True)
        self.assertEqual(out, "hi")

    def test_no_trim(self):
        (out,) = GetFirstWord.execute(text="  hi , x", stop_word=",", trim=False)
        self.assertEqual(out, "  hi ")

    def test_remove_invalid_filename_chars(self):
        (out,) = GetFirstWord.execute(
            text='a<b>c:d', stop_word="\0", remove_invalid_filename_chars=True)
        self.assertEqual(out, "abcd")

    def test_trailing_dot_space_stripped(self):
        (out,) = GetFirstWord.execute(
            text="name. ", stop_word="\0", remove_invalid_filename_chars=True)
        self.assertEqual(out, "name")

    def test_add_trailing_slash_on_nonempty(self):
        (out,) = GetFirstWord.execute(text="folder, x", stop_word=",", add_trailing_slash=True)
        self.assertEqual(out, "folder/")

    def test_add_trailing_slash_skipped_when_empty(self):
        (out,) = GetFirstWord.execute(text=", x", stop_word=",", add_trailing_slash=True)
        self.assertEqual(out, "")

    def test_non_string_text_coerced(self):
        (out,) = GetFirstWord.execute(text=None, stop_word=",")  # type: ignore[arg-type]
        self.assertEqual(out, "")


class TestGetFirstWordList(unittest.TestCase):
    def test_basic_list(self):
        text, lst = GetFirstWordList.execute(
            items=["a, x", "b, y"], stop_word=",", text_separator=" | ")
        self.assertEqual(lst, ["a", "b"])
        self.assertEqual(text, "a | b")

    def test_none_items_becomes_empty(self):
        text, lst = GetFirstWordList.execute(items=None)
        self.assertEqual(lst, [])
        self.assertEqual(text, "")

    def test_tuple_coerced(self):
        _, lst = GetFirstWordList.execute(items=("a, x", "b, y"), stop_word=",")
        self.assertEqual(lst, ["a", "b"])

    def test_bare_string_coerced_to_single_item(self):
        _, lst = GetFirstWordList.execute(items="a, x", stop_word=",")
        self.assertEqual(lst, ["a"])

    def test_none_elements_skipped(self):
        _, lst = GetFirstWordList.execute(items=["a, x", None, "b, y"], stop_word=",")
        self.assertEqual(lst, ["a", "b"])

    def test_non_string_elements_coerced(self):
        _, lst = GetFirstWordList.execute(items=[123], stop_word=",")
        self.assertEqual(lst, ["123"])


class TestPromptTabs(unittest.TestCase):
    def test_active_label(self):
        data = '{"tabs":[{"name":"T1"},{"name":"T2"}],"active":1}'
        text, label = PromptTabs.execute(text="body", tabs_data=data)
        self.assertEqual(text, "body")
        self.assertEqual(label, "T2")

    def test_malformed_json_empty_label(self):
        text, label = PromptTabs.execute(text="body", tabs_data="not json")
        self.assertEqual(text, "body")
        self.assertEqual(label, "")

    def test_missing_tabs_data_empty_label(self):
        _, label = PromptTabs.execute(text="body", tabs_data="")
        self.assertEqual(label, "")

    def test_active_out_of_range(self):
        data = '{"tabs":[{"name":"T1"}],"active":5}'
        _, label = PromptTabs.execute(text="x", tabs_data=data)
        self.assertEqual(label, "")


class TestPromptTabsTranslate(unittest.TestCase):
    def test_passthrough_and_label(self):
        data = '{"tabs":[{"name":"JP","source":"猫","translated":"cat"}],"active":0}'
        source, translated, label = PromptTabsTranslate.execute(
            text="猫", translated="cat", tabs_data=data)
        self.assertEqual(source, "猫")
        self.assertEqual(translated, "cat")
        self.assertEqual(label, "JP")

    def test_non_string_coerced(self):
        source, translated, _ = PromptTabsTranslate.execute(
            text=None, translated=False, tabs_data="")  # type: ignore[arg-type]
        self.assertEqual(source, "")
        self.assertEqual(translated, "")


class TestNodeValueTemplate(unittest.TestCase):
    def test_passthrough(self):
        # Backend is a pure pass-through; token resolution happens in the frontend.
        (out,) = NodeValueTemplate.execute(template="%KSampler.seed%/img")
        self.assertEqual(out, "%KSampler.seed%/img")

    def test_non_string_coerced(self):
        (out,) = NodeValueTemplate.execute(template=123)  # type: ignore[arg-type]
        self.assertEqual(out, "")


if __name__ == "__main__":
    unittest.main(verbosity=2)
