// 画面を開いたときに、その画面のチュートリアルを（まだ見ていなければ）始める

import { useEffect } from 'react';
import { store } from './store';
import type { TutorialId } from './tutorials';

export function useTutorial(...ids: (TutorialId | null | undefined)[]): void {
  const list = ids.filter((id): id is TutorialId => !!id);
  const key = list.join(',');
  useEffect(() => {
    if (list.length > 0) store.screenTutorial(list);
  }, [key]);
}
