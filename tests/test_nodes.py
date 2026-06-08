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
    GemmaTranslate,
    GemmaImagePrompt,
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
                "NodeValueTemplate", "GemmaTranslate", "GemmaImagePrompt",
            },
        )

    def test_display_names_cover_all_classes(self):
        self.assertEqual(
            set(nodes.NODE_CLASS_MAPPINGS),
            set(nodes.NODE_DISPLAY_NAME_MAPPINGS),
        )

    def test_all_input_io_types_are_hashable_strings(self):
        # Every node here subclasses io.ComfyNode, so ComfyUI treats them as V3
        # and runs INPUT_TYPES through parse_class_inputs, which does
        # `value[0] in DYNAMIC_INPUT_LOOKUP` (a dict). If an input's io_type
        # (value[0]) is a bare list — e.g. a combo declared as
        # (["English", ...], {...}) — that hashes a list and ComfyUI raises
        # "unhashable type: 'list'" at prompt validation. Combos must instead be
        # ("COMBO", {"options": [...]}). This guards every node's INPUT_TYPES.
        for name, cls in nodes.NODE_CLASS_MAPPINGS.items():
            spec = cls.INPUT_TYPES()
            for category in ("required", "optional"):
                for input_name, value in spec.get(category, {}).items():
                    io_type = value[0]
                    self.assertIsInstance(
                        io_type, str,
                        f"{name}.{input_name} io_type must be a string "
                        f"(got {type(io_type).__name__}); use "
                        f'("COMBO", {{"options": [...]}}) for dropdowns',
                    )
                    # Must be hashable (this is exactly what ComfyUI does).
                    hash(io_type)


class _FakeClip:
    """Minimal stand-in for a Gemma4 CLIP. Records the instruction prompt and
    returns a canned, deliberately-messy generation so the cleanup logic is
    exercised."""

    def __init__(self, raw="```\nTranslation: \"Hello world\"\n```"):
        self.raw = raw
        self.last_prompt = None

    def tokenize(self, prompt, **kwargs):
        self.last_prompt = prompt
        return {"prompt": prompt}

    def generate(self, tokens, **kwargs):
        return [1, 2, 3]

    def decode(self, ids):
        return self.raw


class TestGemmaTranslate(unittest.TestCase):
    def test_empty_source_returns_empty(self):
        clip = _FakeClip()
        out = GemmaTranslate.execute(clip, text="   ", target_language="English")
        self.assertEqual(out["result"], ("   ", ""))
        # No generation should have been attempted for blank input.
        self.assertIsNone(clip.last_prompt)

    def test_translation_cleaned(self):
        clip = _FakeClip()
        out = GemmaTranslate.execute(clip, text="こんにちは", target_language="English")
        source, translated = out["result"]
        self.assertEqual(source, "こんにちは")
        # Code fence, "Translation:" label and surrounding quotes all stripped.
        self.assertEqual(translated, "Hello world")
        # ui payload mirrors the translated output for the frontend.
        self.assertEqual(out["ui"], {"translated": ["Hello world"]})

    def test_target_language_in_prompt(self):
        clip = _FakeClip(raw="你好")
        GemmaTranslate.execute(clip, text="hello", target_language="Chinese")
        self.assertIn("Chinese (Simplified)", clip.last_prompt)
        self.assertIn("hello", clip.last_prompt)

    def test_generation_error_is_caught(self):
        class _BoomClip(_FakeClip):
            def generate(self, tokens, **kwargs):
                raise RuntimeError("model exploded")

        out = GemmaTranslate.execute(_BoomClip(), text="x", target_language="English")
        source, translated = out["result"]
        self.assertEqual(source, "x")
        self.assertIn("Gemma Translate error", translated)
        self.assertIn("model exploded", translated)

    def test_clean_translation_helper(self):
        self.assertEqual(GemmaTranslate._clean_translation("  hi  "), "hi")
        self.assertEqual(GemmaTranslate._clean_translation('"quoted"'), "quoted")
        self.assertEqual(GemmaTranslate._clean_translation("「日本語」"), "日本語")
        self.assertEqual(
            GemmaTranslate._clean_translation("```json\nfoo\n```"), "foo"
        )


class _FakeVisionClip:
    """Stand-in for a Gemma4 vision CLIP. Records the prompt and whether an image
    was passed, and returns a canned POSITIVE/NEGATIVE generation."""

    def __init__(self, raw="POSITIVE: a cat sitting on a sofa\nNEGATIVE: blurry, lowres"):
        self.raw = raw
        self.last_prompt = None
        self.got_image = False

    def tokenize(self, prompt, image=None, **kwargs):
        self.last_prompt = prompt
        self.got_image = image is not None
        return {"prompt": prompt}

    def generate(self, tokens, **kwargs):
        return [1, 2, 3]

    def decode(self, ids):
        return self.raw


class TestGemmaImagePrompt(unittest.TestCase):
    def test_no_image_no_instruction_returns_empty(self):
        clip = _FakeVisionClip()
        out = GemmaImagePrompt.execute(clip, image=None, instruction="   ")
        self.assertEqual(out["result"], ("", ""))
        self.assertIsNone(clip.last_prompt)  # no generation attempted

    def test_parses_positive_and_negative(self):
        clip = _FakeVisionClip()
        out = GemmaImagePrompt.execute(
            clip, image=object(), target_model="SDXL")
        positive, negative = out["result"]
        self.assertEqual(positive, "a cat sitting on a sofa")
        self.assertEqual(negative, "blurry, lowres")
        self.assertEqual(out["ui"], {
            "positive": ["a cat sitting on a sofa"],
            "negative": ["blurry, lowres"],
        })
        self.assertTrue(clip.got_image)  # image forwarded to the tokenizer

    def test_no_image_uses_instruction_only(self):
        clip = _FakeVisionClip(raw="POSITIVE: a red sports car\nNEGATIVE:")
        out = GemmaImagePrompt.execute(
            clip, image=None, instruction="a red sports car")
        positive, negative = out["result"]
        self.assertEqual(positive, "a red sports car")
        self.assertEqual(negative, "")
        self.assertFalse(clip.got_image)
        self.assertIn("a red sports car", clip.last_prompt)

    def test_settings_shape_the_request(self):
        clip = _FakeVisionClip()
        GemmaImagePrompt.execute(
            clip, image=object(), output_format="Danbooru tags",
            target_model="SDXL", detail_mode="Expand detail")
        p = clip.last_prompt
        self.assertIn("Danbooru", p)
        self.assertIn("SDXL", p)
        self.assertIn("negative prompt", p.lower())
        self.assertIn("enrich", p.lower())

    def test_flux_does_not_request_negative_prompt(self):
        clip = _FakeVisionClip()
        GemmaImagePrompt.execute(clip, image=object(), target_model="FLUX")
        p = clip.last_prompt
        self.assertIn("FLUX", p)
        # FLUX branch tells the model to leave the negative prompt empty and
        # must NOT ask it to "Also provide a concise negative prompt" (SDXL only).
        self.assertNotIn("Also provide a concise negative prompt", p)
        self.assertIn("leave the negative", p.lower())

    def test_empty_negative_placeholder_normalized(self):
        clip = _FakeVisionClip(raw="POSITIVE: a tree\nNEGATIVE: (empty)")
        _, negative = GemmaImagePrompt.execute(clip, image=object())["result"]
        self.assertEqual(negative, "")

    def test_missing_labels_fall_back_to_positive(self):
        clip = _FakeVisionClip(raw="just a plain prompt with no labels")
        positive, negative = GemmaImagePrompt.execute(clip, image=object())["result"]
        self.assertEqual(positive, "just a plain prompt with no labels")
        self.assertEqual(negative, "")

    def test_generation_error_is_caught(self):
        class _BoomClip(_FakeVisionClip):
            def generate(self, tokens, **kwargs):
                raise RuntimeError("vision exploded")

        out = GemmaImagePrompt.execute(_BoomClip(), image=object())
        positive, negative = out["result"]
        self.assertIn("Gemma Image Prompt error", positive)
        self.assertIn("vision exploded", positive)
        self.assertEqual(negative, "")

    def test_default_mode_is_generation(self):
        clip = _FakeVisionClip()
        GemmaImagePrompt.execute(clip, image=object())
        # Generation mode asks to recreate a similar NEW image, not to edit.
        self.assertIn("visually similar", clip.last_prompt)
        self.assertNotIn("EDITING INSTRUCTION", clip.last_prompt)

    def test_edit_instruction_mode_request(self):
        clip = _FakeVisionClip()
        GemmaImagePrompt.execute(
            clip, image=object(),
            instruction="make the car blue",
            prompt_mode="Edit instruction (change description)")
        p = clip.last_prompt
        # Edit mode must ask for a change description (before -> after), not a
        # plain recreation prompt.
        self.assertIn("EDITING INSTRUCTION", p)
        self.assertIn("original element", p)
        self.assertIn("what it should become", p)
        self.assertNotIn("visually similar", p)
        self.assertIn("User's requested edit: make the car blue", p)

    def test_edit_mode_leaves_negative_empty_instruction(self):
        # Even with SDXL selected, edit mode tells the model not to use a
        # negative prompt (image-editing models are instruction-based).
        clip = _FakeVisionClip()
        GemmaImagePrompt.execute(
            clip, image=object(), target_model="SDXL",
            prompt_mode="Edit instruction (change description)")
        p = clip.last_prompt
        self.assertIn("do not use a negative prompt", p)
        self.assertNotIn("Also provide a concise negative prompt", p)


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
