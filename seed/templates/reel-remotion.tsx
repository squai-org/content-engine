/*
<meta name="size" content="1080x1920">
<meta name="formats" content="reel">
<meta name="engine" content="remotion">
*/
import { TransitionSeries, springTiming } from '@remotion/transitions';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

type Scene = { kicker: string; title: string; body: string; note: string; source: string; seconds: number };
type Props = { service: string; duration: number; scenes: Scene[] };

const FONTS =
  'https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@700&family=Atkinson+Hyperlegible+Next:wght@400;600&family=Gloria+Hallelujah&display=swap';
const HEAD = "'Familjen Grotesk', 'Arial Narrow', sans-serif";
const BODY = "'Atkinson Hyperlegible Next', 'Segoe UI', sans-serif";
const HAND = "'Gloria Hallelujah', cursive";
const MID = '#0A0C1A';
const CANVAS = '#F4F6FF';
const SERVICES: Record<string, { main: string; main3: string; hl: string }> = {
  grow: { main: '#44d4c8', main3: '#c8f1ec', hl: '#f9c24d' },
  learn: { main: '#f9c24d', main3: '#ffe6a6', hl: '#8a8ef9' },
  one: { main: '#8a8ef9', main3: '#e4e6f7', hl: '#44d4c8' },
};
const TRANSITION = 14;
const CONTENT_WIDTH = 900;
const CHAR_WIDTH = 0.58;

function useFonts(): void {
  const [handle] = useState(() => delayRender('Tipografías'));
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONTS;
    const done = () => continueRender(handle);
    link.onload = () =>
      Promise.all(
        ["700 80px 'Familjen Grotesk'", "400 40px 'Atkinson Hyperlegible Next'", "400 40px 'Gloria Hallelujah'"].map(
          (font) => document.fonts.load(font),
        ),
      ).then(done, done);
    link.onerror = done;
    document.head.append(link);
  }, [handle]);
}

function Shape({ style, turn }: { style: CSSProperties; turn: number }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = frame / durationInFrames;
  return (
    <div
      style={{
        position: 'absolute',
        borderRadius: '31%',
        transform: `translateY(${progress * -140}px) rotate(${turn + progress * 24}deg)`,
        ...style,
      }}
    />
  );
}

function Title({ text, highlight, size }: { text: string; highlight: string; size: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const parts = text.split(/(\[\[.+?\]\])/).filter(Boolean);
  let count = 0;
  const word = (value: string, key: string) => {
    const enter = spring({ frame: frame - 5 - count * 2, fps, config: { damping: 13, mass: 0.6 } });
    count += 1;
    return (
      <span
        key={key}
        style={{
          display: 'inline-block',
          opacity: enter,
          transform: `translateY(${(1 - enter) * 80}px) rotate(${(1 - enter) * 5}deg)`,
        }}
      >
        {value}
      </span>
    );
  };
  const words = (value: string, key: string) =>
    value.split(/(\s+)/).map((piece, index) => (piece.trim() ? word(piece, `${key}-${index}`) : piece));
  const total = text.replace(/\[\[|\]\]/g, '').split(/\s+/).length;
  const ink = spring({ frame: frame - 10 - total * 2, fps, config: { damping: 200 } });
  return (
    <h1
      style={{
        margin: 0,
        fontFamily: HEAD,
        fontWeight: 700,
        fontSize: size,
        letterSpacing: '-0.03em',
        lineHeight: 1.12,
        textWrap: 'balance',
      }}
    >
      {parts.map((part, index) =>
        part.startsWith('[[') ? (
          <span
            key={`m${index}`}
            style={{ position: 'relative', isolation: 'isolate', display: 'inline-block', padding: '0 0.16em', margin: '0 -0.06em', whiteSpace: 'nowrap' }}
          >
            <span
              style={{
                position: 'absolute',
                inset: '0.08em 0 0.02em',
                zIndex: -1,
                borderRadius: '0.3em',
                background: highlight,
                transformOrigin: 'left',
                transform: `scaleX(${ink})`,
              }}
            />
            {words(part.slice(2, -2), `m${index}`)}
          </span>
        ) : (
          words(part, `p${index}`)
        ),
      )}
    </h1>
  );
}

function SceneView({ scene, colors, colored, last }: { scene: Scene; colors: (typeof SERVICES)[string]; colored: boolean; last: boolean }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = scene.title.split(/\s+/).length;
  const after = 14 + words * 2;
  const rise = (delay: number) => {
    const enter = spring({ frame: frame - delay, fps, config: { damping: 200 } });
    return { opacity: enter, transform: `translateY(${(1 - enter) * 44}px)` };
  };
  const pop = spring({ frame: frame - after - 14, fps, config: { damping: 9, mass: 0.5 } });
  const length = scene.title.replace(/\[\[|\]\]/g, '').length;
  const widest = Math.max(
    ...scene.title.split(/\[\[|\]\]/).flatMap((part, index) => (index % 2 ? [part] : part.split(/\s+/))).map((part) => part.length),
  );
  const size = Math.round(
    Math.min(
      interpolate(length, [18, 60], [150, 92], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
      CONTENT_WIDTH / (CHAR_WIDTH * (widest + 1)),
    ),
  );
  return (
    <AbsoluteFill style={{ background: colored ? colors.main : CANVAS, color: MID, fontFamily: BODY }}>
      <AbsoluteFill
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(10,12,26,.07) 2px, transparent 2px), linear-gradient(to bottom, rgba(10,12,26,.07) 2px, transparent 2px)',
          backgroundSize: '180px 240px',
        }}
      />
      <Shape turn={-8} style={{ left: -200, top: 1500, width: 580, height: 590, background: colors.main3 }} />
      <Shape turn={6} style={{ right: -220, top: 110, width: 480, height: 490, background: colors.main3 }} />
      <div
        style={{
          position: 'absolute',
          left: 90,
          right: 90,
          top: 290,
          bottom: last ? 600 : 460,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 44,
        }}
      >
        {scene.kicker && (
          <div
            style={{
              alignSelf: 'flex-start',
              padding: '10px 26px',
              borderRadius: 999,
              background: MID,
              color: CANVAS,
              fontWeight: 600,
              fontSize: 34,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              ...rise(2),
            }}
          >
            {scene.kicker}
          </div>
        )}
        <Title text={scene.title} highlight={colors.hl} size={size} />
        {scene.body && (
          <p style={{ margin: 0, fontSize: 54, lineHeight: 1.32, textWrap: 'balance', ...rise(after) }}>
            {scene.body.replace(/\[\[|\]\]/g, '')}
          </p>
        )}
        {scene.note && (
          <p
            style={{
              margin: 0,
              fontFamily: HAND,
              fontSize: 50,
              lineHeight: 1.3,
              transformOrigin: 'left',
              opacity: Math.min(1, pop),
              transform: `rotate(${-8 + pop * 6}deg) scale(${0.8 + pop * 0.2})`,
            }}
          >
            {scene.note}
          </p>
        )}
        {scene.source && (
          <p style={{ margin: 0, fontWeight: 600, fontSize: 30, ...rise(after + 6), opacity: rise(after + 6).opacity * 0.7 }}>
            {scene.source}
          </p>
        )}
      </div>
      {last && (
        <div
          style={{
            position: 'absolute',
            left: 90,
            bottom: 470,
            fontFamily: HEAD,
            fontWeight: 700,
            fontSize: 64,
            letterSpacing: -1,
            ...rise(after + 10),
          }}
        >
          squai.io
        </div>
      )}
    </AbsoluteFill>
  );
}

export default function Reel({ service, scenes }: Props) {
  useFonts();
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const colors = SERVICES[service.trim().toLowerCase()] ?? SERVICES.grow;
  const last = scenes.length - 1;
  return (
    <AbsoluteFill style={{ background: CANVAS }}>
      <TransitionSeries>
        {scenes.flatMap((scene, index) => {
          const frames = Math.round(scene.seconds * fps) + (index < last ? TRANSITION : 0);
          const sequence = (
            <TransitionSeries.Sequence key={`s${index}`} durationInFrames={frames}>
              <SceneView scene={scene} colors={colors} colored={index === 0 || index === last} last={index === last} />
            </TransitionSeries.Sequence>
          );
          if (index === last) return [sequence];
          return [
            sequence,
            <TransitionSeries.Transition
              key={`t${index}`}
              presentation={index % 2 === 0 ? slide({ direction: 'from-bottom' }) : wipe({ direction: 'from-left' })}
              timing={springTiming({ config: { damping: 200 }, durationInFrames: TRANSITION })}
            />,
          ];
        })}
      </TransitionSeries>
      <div
        style={{
          position: 'absolute',
          left: 90,
          right: 90,
          top: 150,
          height: 8,
          borderRadius: 4,
          background: 'rgba(10,12,26,.18)',
          overflow: 'hidden',
        }}
      >
        <div style={{ width: `${(frame / durationInFrames) * 100}%`, height: '100%', background: MID }} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 90,
          top: 196,
          color: MID,
          fontFamily: HEAD,
          fontWeight: 700,
          fontSize: 44,
          letterSpacing: -0.5,
        }}
      >
        @heysquai
      </div>
    </AbsoluteFill>
  );
}
