// 思わぬエラーで画面が真っ白にならないようにする。エラーの画面を出し、セーブを書き出せるようにする。

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { APP_VERSION, ISSUES_URL } from '../about';
import { downloadSave } from '../storage';
import { store } from '../store';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error, info.componentStack);
  }

  private backToTitle = () => {
    store.setLocked(false);
    store.setGame(null, null);
    store.open({ name: 'title' });
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const game = store.game;
    return (
      <div className="title-screen">
        <div className="title-card">
          <h1>問題が起きました</h1>
          <p>ゲームの途中で思わぬエラーが起きて、この画面を表示できませんでした。</p>
          <p className="muted small">エラーの内容：{error.message}</p>
          <p>最後に保存した状態は、タイトルの「続きから」に残っています。念のため、今の状態をファイルに書き出しておけます。</p>
          <div className="title-buttons">
            {game && <button type="button" className="primary" onClick={() => downloadSave(game)}>今の状態を書き出す</button>}
            <button type="button" className="secondary" onClick={this.backToTitle}>タイトルに戻る</button>
            <button type="button" className="secondary" onClick={() => window.location.reload()}>ページを読み込み直す</button>
          </div>
          <p className="muted small">
            何度も起きるときは、エラーの内容と直前にしたことを<a href={ISSUES_URL} target="_blank" rel="noreferrer">こちら</a>に知らせてもらえると助かります（版 {APP_VERSION}）。
          </p>
        </div>
      </div>
    );
  }
}
