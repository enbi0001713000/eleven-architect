// ドット絵のピッチ（DotScene）を画面に置く部品。手が進むたびに新しい状態と出来事を渡し、絵は DotScene が毎コマ描く。
// 大きさは置かれた場所に合わせる（大きく見るモードでは画面いっぱい）。

import { useEffect, useRef } from 'react';
import type { LiveSnapshot } from '../../engine/match';
import type { MatchEvent } from '../../engine/types';
import { DotScene, type DotPlayerInfo, type DotSceneOptions } from '../dotScene';
import type { CameraMode } from '../settings';

export function DotPitch({ snapshot, events, moveMs, camera, options, infoOf, className }: {
  snapshot: LiveSnapshot;
  events: readonly MatchEvent[];
  moveMs: number;
  camera: CameraMode;
  options: DotSceneOptions;
  infoOf: (id: string) => DotPlayerInfo | undefined;
  className?: string;
}) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const overlay = useRef<HTMLCanvasElement | null>(null);
  const scene = useRef<DotScene | null>(null);
  const seen = useRef(0);
  const info = useRef(infoOf);
  info.current = infoOf;

  useEffect(() => {
    const box = wrap.current;
    if (!box || !canvas.current || !overlay.current) return;
    const s = new DotScene(canvas.current, overlay.current, options, (id) => info.current(id));
    scene.current = s;
    const fit = () => s.resize(box.clientWidth, box.clientHeight, window.devicePixelRatio || 1);
    fit();
    s.step(snapshot, [], 0);
    seen.current = events.length;
    s.start();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => {
      observer.disconnect();
      s.stop();
      scene.current = null;
    };
  }, [options.seed]); // 試合ごとに1回作る（色やスタンドは試合の間は変わらない）

  // 手が進んだら（出来事が増えるか、時計が進んだら）次の動きを決める
  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    const fresh = events.slice(seen.current);
    seen.current = events.length;
    s.step(snapshot, fresh, moveMs);
  }, [snapshot.clock, events.length, snapshot.phase, snapshot.ball.holderId]);

  useEffect(() => {
    scene.current?.setCamera(camera);
  }, [camera]);

  return (
    <div ref={wrap} className={`dot-pitch${className ? ` ${className}` : ''}`}>
      <canvas ref={canvas} className="dot-pitch-art" role="img" aria-label="ドット絵のピッチ（選手とボール）" />
      <canvas ref={overlay} className="dot-pitch-labels" aria-hidden="true" />
    </div>
  );
}
