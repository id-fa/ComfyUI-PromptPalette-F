# ComfyUI PromptPalette-F

トリガーワードやフレーズのメモを取りつつトグルでオン・オフを切り替えできるComfyUI用カスタムノード

![Example](examples/example-alt01.png)

## 機能

- **フレーズの切り替え** - チェックボックスでのON/OFF切り替え
- **フレーズの重み調整** - +/-ボタンでの重み調整 （※最初の単語のみ）
- **グループ一括制御** - `[グループ名]` タグでフレーズをグループ化して一括制御
- **カスタム区切り文字** - 結合するための区切り文字設定（デフォルト：カンマ+スペース）
- **出力** - カスタム区切り文字で連結されたテキスト

## インストール

1. ComfyUIの `custom_nodes` ディレクトリにクローン
2. ComfyUIを再起動

## 使い方

1. **ノードを追加**: `PromptPalette-F` ノードをワークフローに追加
2. **テキスト編集**:
   - **Edit**ボタンをクリックして編集モードに切り替え
   - 1行に1つのフレーズを入力
   - **Save**ボタンをクリックして編集を完了
3. **フレーズ制御**:
   - 表示モードで**チェックボックス**を切り替えてフレーズを有効/無効化
   - **+/-ボタン**でフレーズの重みを調整
   - **グループボタン**でグループ全体を一括制御
4. **カスタム区切り文字の設定**（オプション）:
   - separatorフィールドでフレーズを結合する区切り文字を設定（デフォルト：`, `）
   - 区切り文字なし/間隔なしの場合は空文字列を使用
5. **説明コメントの追加**（オプション）:
   - `#` で始まる行を追加して説明コメントを記述
   - コメントは次のフレーズの上に説明テキストとして表示
6. **出力**:
   - 選択されたフレーズが設定された区切り文字で出力される

## 高度な使い方

### コメントの種類

- **切り替えコメント（`//`）**: `//` で始まる行はチェックボックスがOFFの状態がデフォルトになる
- **説明コメント（`#`）**: `#` で始まる行は次のフレーズの上に説明テキストとして表示

### グループ機能

- **基本的な使い方**: 行の末尾に `[グループ名]` を追加してグループを作成
- **複数グループ**: 1つのフレーズに複数のグループタグを設定可能（例：`[nature][style1]`）
- **グループ制御**: ノード上部に表示されるグループボタンで一括制御
- **エスケープ**: 実際の角括弧を出力したい場合は `\[` と `\]` でエスケープ

#### グループ使用例:
```
beautiful landscape [nature-warm1]
sunset colors [nature-warm2]
// character design [char1]
anime girl [char1][char2]
high quality
model \[v2.1\] settings [model21]
```

### 設定項目

Nodes 2.0モードでは編集モード時の設定行に省略表示されます。括弧内が省略名。

- **text** - メインの入力テキスト（1行に1フレーズ）
- **prefix** - テキストの前に置く文字列（複数ノード連結用）
- **separator** （`Sep`） - フレーズを結合する際の区切り文字（デフォルト：`, `）
- **trailing_separator** （`Trail`） - 最後のフレーズの後にも区切り文字を追加
- **separator_newline** （`Sep NL`） - 各区切り文字の後に改行を追加
- **add_newline** （`End NL`） - 最終出力の末尾に改行を追加
- **prefix_separator** （`Prefix Sep`） - prefix と本文の間に separator を挿入する（デフォルトOFF。OFFなら `prefix + 本文` がそのまま連結される）
- **empty_when_no_selection** （`Empty if no sel`） - 選択されているフレーズが1つもない時に、出力(text / selected_text / selected_list)をすべて Python `None` にする。prefix も改行も出力されない。下流で [rgthree Any Switch](https://github.com/rgthree/rgthree-comfy) などの `value is None` を判定するスイッチに繋いで、選択ゼロ時に別の入力へルーティングする用途を想定（デフォルトOFF）

## Simple Multi Concat Text ノード

- カテゴリ: `utils`
- 表示名: `Simple Multi Concat Text`
- クラス: `SimpleMultiConcatText`

最大5つのテキスト入力を区切り文字で連結するUIなしのユーティリティノードです。

入力:

| 入力 | 型 | 説明 |
| --- | --- | --- |
| `text1`〜`text5` | STRING | 連結するテキスト（すべて接続専用のスロット。未接続・空・None の入力は自動的に除外されるので `a,,b` のような区切り文字の連続が発生しません） |
| `separator` | STRING | 連結時の区切り文字（デフォルト：`""`＝空文字） |
| `separator_newline` | BOOLEAN | ONで区切り文字の後に改行を追加。`separator=""` のときでも機能し、その場合は改行のみで行ごとに連結されます（デフォルトOFF） |
| `add_newline` | BOOLEAN | ONで出力末尾に改行を追加。有効な入力が1つもないときはスキップされます（デフォルトOFF） |

出力:

| 出力 | 型 | 意味 |
| --- | --- | --- |
| `text` | STRING | 有効な入力を区切り文字で連結したテキスト |

![screenshot](examples/prompt_tabs.png)


## Get First Word ノード

- カテゴリ: `utils`
- 表示名: `Get First Word`
- クラス: `GetFirstWord`

入力テキストから、指定した区切り文字（ストップワード）が最初に現れる位置より前の部分を取り出すUIなしのユーティリティノードです。先頭の単語の抽出や、プロンプトからのファイル名・フォルダ名生成などに使えます。

入力:

| 入力 | 型 | 説明 |
| --- | --- | --- |
| `text` | STRING | 入力テキスト（接続専用スロット） |
| `stop_word` | STRING | この文字列が最初に現れる位置より前を出力（デフォルト：`,`）。リテラルモードでは `\n` `\r` `\t` のエスケープシーケンスが展開されるので、1行ウィジェットで改行・タブを指定できます |
| `use_regex` | BOOLEAN | ONで `stop_word` を正規表現として解釈。無効なパターンの場合はテキスト全体を返します（例外を投げません）。ONのときはエスケープ展開はスキップ（デフォルトOFF） |
| `trim` | BOOLEAN | 結果の前後の空白・改行を除去（デフォルトON） |
| `remove_invalid_filename_chars` | BOOLEAN | Windowsのファイル名で禁止されている文字（`<>:"/\|?*` と制御文字）と末尾のドット・スペースを除去（デフォルトOFF） |
| `add_trailing_slash` | BOOLEAN | フォルダパスとして使えるよう末尾に `/` を追加。結果が空のときはスキップ（デフォルトOFF） |

`stop_word` が空文字の場合はテキスト全体を返します。

出力:

| 出力 | 型 | 意味 |
| --- | --- | --- |
| `text` | STRING | ストップワードより前の部分 |

## Get First Word (List) ノード

- カテゴリ: `utils`
- 表示名: `Get First Word (List)`
- クラス: `GetFirstWordList`

`Get First Word` の処理を LIST 入力の各要素に適用するUIなしのユーティリティノードです。`PromptPalette-F` の `selected_list` 出力などと組み合わせて使えます。

入力:

| 入力 | 型 | 説明 |
| --- | --- | --- |
| `items` | LIST | 処理対象のリスト（接続専用スロット） |
| `stop_word` / `use_regex` / `trim` / `remove_invalid_filename_chars` / `add_trailing_slash` | — | `Get First Word` と同じ設定（各要素に適用） |
| `text_separator` | STRING | `text` 出力で結果を連結する際の区切り文字（デフォルト：`, `）。`list` 出力には影響しません |

出力:

| 出力 | 型 | 意味 |
| --- | --- | --- |
| `text` | STRING | 各要素の処理結果を `text_separator` で連結したテキスト |
| `list` | LIST | 各要素の処理結果のリスト（生の結果。区切り文字の影響を受けません） |

## Prompt Tabs ノード

- カテゴリ: `utils`
- 表示名: `Prompt Tabs`
- クラス: `PromptTabs`

名前付きのプロンプトタブを好きなだけ1つのノードに保持できるメモ帳スタイルのテキストノードです。現在アクティブなタブのテキストを出力します。タブを切り替えることで、別のプロンプトを削除せずに残しておけるので、試行錯誤しながら以前のプロンプトに戻りたいときに便利です。

| 操作 | 方法 |
| --- | --- |
| タブ切り替え | タブをクリック |
| タブ追加 | `+` をクリック（タブ数は無制限。複数行に折り返して表示されます） |
| タブの改名 | タブをダブルクリック |
| タブ削除 | タブの `×` をクリック（確認ダイアログあり。最低1つのタブは必ず残ります） |

出力:

| 出力 | 型 | 意味 |
| --- | --- | --- |
| `text` | STRING | アクティブなタブの内容 |
| `label` | STRING | アクティブなタブの名前（`Tab 1`、`Tab 2`、または改名した名前） |

## 関連

[Claude CodeでComfyUIのカスタムノードを改造してみた - ふぁメモ](https://fa.hatenadiary.jp/entry/20250921/1758380400)


---

# ComfyUI PromptPalette-F

A custom node for ComfyUI that makes prompt editing easier by allowing phrase switching with just mouse operations

![Example](examples/example-alt01.png)

## Features

- **Toggle phrases** with checkboxes
- **Adjust phrase weights** using +/- buttons
- **Group batch control** using `[groupname]` tags to control multiple phrases at once
- **Prefix input** to combine with generated text
- **Custom separator** for joining phrases (default: comma + space)
- **Output** as properly formatted text with custom separators

## Installation

1. Clone into the `custom_nodes` directory of ComfyUI
2. Restart ComfyUI

## Usage

1. **Add the node**: Add the `PromptPalette-F` node to your workflow
2. **Edit text**:
   - Click the **Edit** button to switch to edit mode
   - Enter one phrase per line
   - Click the **Save** button to complete editing
3. **Control phrases**:
   - **Toggle checkboxes** in display mode to enable/disable phrases
   - **Adjust phrase weights** using +/- buttons
   - **Use group buttons** for batch control of entire groups
4. **Set custom separator** (optional):
   - Configure the separator field to join phrases (default: `, `)
   - Use empty string for no separator/spacing
5. **Add description comments** (optional):
   - Start lines with `#` to add descriptive comments
   - Comments appear above the following phrase as explanatory text
6. **Output**:
   - Selected phrases are output with the configured separator

## Advanced Usage

### Comment Types

- **Toggle comments (`//`)**: Lines starting with `//` are toggled off by default
- **Description comments (`#`)**: Lines starting with `#` appear as explanatory text above the next phrase

### Group Functionality

- **Basic usage**: Add `[groupname]` at the end of lines to create groups
- **Multiple groups**: One phrase can belong to multiple groups (e.g., `[nature][style1]`)
- **Group controls**: Group buttons appear at the top of the node for batch control
- **Escaping**: Use `\[` and `\]` to output literal brackets

#### Group Usage Example:
```
beautiful landscape [nature-warm1]
sunset colors [nature-warm2]
// character design [char1]
anime girl [char1][char2]
high quality
model \[v2.1\] settings [model21]
```

**Output** (when all groups are active):
```
beautiful landscape, sunset colors, anime girl, high quality, model [v2.1] settings
```

### Settings

In Nodes 2.0 mode these appear as short labels in the edit-mode options row. The parenthesized name is what shows up in that UI.

- **text** — main input text (one phrase per line)
- **prefix** — text prepended before the body (for chaining multiple nodes)
- **separator** (`Sep`) — separator used to join phrases (default: `, `)
- **trailing_separator** (`Trail`) — also append the separator after the last phrase
- **separator_newline** (`Sep NL`) — append a newline after each separator
- **add_newline** (`End NL`) — append a newline at the very end of the output
- **prefix_separator** (`Prefix Sep`) — insert `separator` between `prefix` and the body (default OFF; when OFF, `prefix + body` is concatenated as-is)
- **empty_when_no_selection** (`Empty if no sel`) — when no phrase is selected, return Python `None` for all three outputs (text / selected_text / selected_list). `prefix` and trailing newlines are NOT emitted. Intended for downstream switches that check `value is None` (e.g. [rgthree Any Switch](https://github.com/rgthree/rgthree-comfy)) to route to a different input when nothing is selected (default OFF)

## Simple Multi Concat Text Node

- Category: `utils`
- Display name: `Simple Multi Concat Text`
- Class: `SimpleMultiConcatText`

A UI-less utility node that joins up to 5 text inputs with a separator. Useful for combining the outputs of multiple `PromptPalette-F` nodes, among other things.

Inputs:

| Input | Type | Description |
| --- | --- | --- |
| `text1`–`text5` | STRING | Texts to join (all wire-only slots. Unconnected / empty / None inputs are automatically filtered out, so you never get runs of separators like `a,,b`) |
| `separator` | STRING | Separator used when joining (default: `""`, empty string) |
| `separator_newline` | BOOLEAN | When ON, append a newline after the separator. Works even when `separator=""`, in which case inputs are joined line-by-line with just a newline (default OFF) |
| `add_newline` | BOOLEAN | When ON, append a newline at the end of the output. Skipped when there are no valid inputs (default OFF) |

Output:

| Output | Type | Meaning |
| --- | --- | --- |
| `text` | STRING | The valid inputs joined with the separator |

## Get First Word Node

- Category: `utils`
- Display name: `Get First Word`
- Class: `GetFirstWord`

A UI-less utility node that returns the portion of the input text before the first occurrence of a stop word. Useful for extracting the first word, or for generating filenames / folder names from a prompt.

Inputs:

| Input | Type | Description |
| --- | --- | --- |
| `text` | STRING | Input text (wire-only slot) |
| `stop_word` | STRING | Output everything before the first occurrence of this string (default: `,`). In literal mode the escape sequences `\n` `\r` `\t` are expanded, so you can specify newlines/tabs from the single-line widget |
| `use_regex` | BOOLEAN | When ON, interpret `stop_word` as a regular expression. Invalid patterns return the whole text (never raises). Escape expansion is skipped when ON (default OFF) |
| `trim` | BOOLEAN | Strip leading/trailing whitespace and newlines from the result (default ON) |
| `remove_invalid_filename_chars` | BOOLEAN | Remove characters Windows forbids in filenames (`<>:"/\|?*` and control chars) plus trailing dots/spaces (default OFF) |
| `add_trailing_slash` | BOOLEAN | Append a `/` so the result can be used as a folder path. Skipped when the result is empty (default OFF) |

An empty `stop_word` returns the whole text.

Output:

| Output | Type | Meaning |
| --- | --- | --- |
| `text` | STRING | The portion before the stop word |

## Get First Word (List) Node

- Category: `utils`
- Display name: `Get First Word (List)`
- Class: `GetFirstWordList`

A UI-less utility node that applies the `Get First Word` transform to every element of a LIST input. Pairs well with the `selected_list` output of `PromptPalette-F`.

Inputs:

| Input | Type | Description |
| --- | --- | --- |
| `items` | LIST | The list to process (wire-only slot) |
| `stop_word` / `use_regex` / `trim` / `remove_invalid_filename_chars` / `add_trailing_slash` | — | Same settings as `Get First Word` (applied to each element) |
| `text_separator` | STRING | Separator used to join the results in the `text` output (default: `, `). Does not affect the `list` output |

Outputs:

| Output | Type | Meaning |
| --- | --- | --- |
| `text` | STRING | The per-element results joined with `text_separator` |
| `list` | LIST | The list of per-element results (raw; unaffected by the separator) |

## Prompt Tabs Node

- Category: `utils`
- Display name: `Prompt Tabs`
- Class: `PromptTabs`

A notepad-style text node that keeps **any number of named prompt tabs** in a single box and outputs the text of the currently-active tab. Switch tabs to keep alternate prompts around without deleting them — handy when experimenting and you want to jump back to an earlier prompt.

| Action | How |
| --- | --- |
| Switch tab | Click the tab |
| Add tab | Click `+` (tabs can grow without limit; they wrap onto multiple rows) |
| Rename tab | Double-click the tab |
| Delete tab | Click the `×` on the tab — asks for confirmation first (at least one tab always remains) |

Outputs:

| Output | Type | Meaning |
| --- | --- | --- |
| `text` | STRING | The content of the active tab |
| `label` | STRING | The name of the active tab (`Tab 1`, `Tab 2`, or whatever you renamed it to) |

This node ships a small JavaScript widget (in `web/`), so it needs a ComfyUI version that loads custom-node frontends. If the frontend fails to load it degrades to a plain multiline text box.

