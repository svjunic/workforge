# TASK-001 ログイン画面追加

## 目的

email / password によるログイン画面を追加する。

---

## 背景

- 現在ログイン機能は未実装
- 認証APIは既に存在している
- UIデザインは Figma を参照する

---

## 作業範囲

### 変更許可

- apps/web/app/login/**
- apps/web/components/**
- packages/ui/**

### 変更禁止

- infra/**
- database/**
- package.json
- lockfile

---

## 要件

- email/password 入力フォームを表示する
- ログインボタンを表示する
- 未入力時は validation error を表示する
- ログイン成功時は `/dashboard` へ遷移する
- ログイン失敗時は toast を表示する

---

## 対象外

- サインアップ機能
- パスワードリセット
- OAuth
- backend の認証実装

---

## 受け入れ条件

- ログイン画面が表示される
- モバイル幅でもUIが崩れない
- `console.error` が発生しない
- hydration error が発生しない

---

## 検証コマンド

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

---

## テスト方針

- Vitest による unit test
- Playwright によるログインフロー確認

---

## 最初に確認するファイル

- apps/web/app/page.tsx
- apps/web/components/form/*
- packages/ui/button.tsx

---

## 実装メモ

- 既存の Button component を再利用する
- server action は使用しない
- react-hook-form 使用可

---

## 制約

- App Router 構成を維持する
- TypeScript strict mode を壊さない
- `any` を追加しない

---

## エージェント向け指示

- まず既存実装を調査する
- 小さい commit 単位で進める
- 不要な refactor をしない
- 作業範囲外の変更は禁止

---

## 完了条件

- 検証コマンドが全て成功する
- 受け入れ条件を満たす
- diff が作業範囲内に収まっている

---

## リトライ方針

最大3回まで self-fix を許可する。

失敗時は以下を確認して修正すること。

- test log
- build log
- stack trace

---

## 出力内容

- commit 内容
- 変更ファイル一覧
- 実装概要
- 残課題 / リスク
