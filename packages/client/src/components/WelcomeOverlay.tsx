import { useState, useEffect, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import type * as THREE from 'three';

type OnboardingStep =
  | 'intro'
  | 'camera_controls'
  | 'click_om'
  | 'assign_desk'
  | 'send_message'
  | 'outro';

interface OnboardingDialogueProps {
  step: OnboardingStep;
  onAdvance: () => void;
}

const DIALOGUE: Record<OnboardingStep, { lines: string[]; waitForAction: boolean }> = {
  intro: {
    lines: [
      "Hey there. I'm the Office Manager.",
      "Welcome to your new office. It's a bit empty right now, but that's about to change.",
      'Before we get started, let me show you how to look around.',
    ],
    waitForAction: false,
  },
  camera_controls: {
    lines: ['Try moving the camera now — use the controls below to look around the office.'],
    waitForAction: true,
  },
  click_om: {
    lines: [
      "See me over there? The gray capsule, that's me.",
      'Click on me in the viewport to open my panel.',
    ],
    waitForAction: true,
  },
  assign_desk: {
    lines: [
      'First things first — I need somewhere to work.',
      "Click the 'Assign Desk' button in my panel, then pick a desk for me.",
    ],
    waitForAction: true,
  },
  send_message: {
    lines: [
      'Perfect. Now you can talk to me through that chat box.',
      'Tell me what you want built — a todo app, a blog, whatever you need.',
      'Type your goal in the chat and hit send.',
    ],
    waitForAction: true,
  },
  outro: {
    lines: [
      "Got it. I'll take it from here.",
      "I'm going to hire some developers, organize them into teams, and start building.",
      'You can watch everything happen in real time. Good luck, boss.',
    ],
    waitForAction: false,
  },
};

const S = {
  container: {
    position: 'fixed' as const,
    bottom: 0,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 90,
    display: 'flex',
    alignItems: 'flex-end',
    pointerEvents: 'auto' as const,
  },
  portrait: {
    width: '110px',
    height: '220px',
    flexShrink: 0,
    marginRight: '-8px',
  },
  box: {
    background: 'rgba(20, 20, 40, 0.95)',
    border: '2px solid #4a4a7a',
    borderRadius: '12px',
    padding: '16px 20px',
    width: '520px',
    maxWidth: 'calc(100vw - 140px)',
    fontFamily: 'monospace',
    position: 'relative' as const,
    marginBottom: '32px',
  },
  nameTag: {
    position: 'absolute' as const,
    top: '-12px',
    left: '16px',
    background: '#6366f1',
    color: '#fff',
    fontSize: '10px',
    fontWeight: 'bold' as const,
    padding: '2px 10px',
    borderRadius: '4px',
    fontFamily: 'monospace',
    letterSpacing: '0.03em',
  },
  text: {
    color: '#e2e8f0',
    fontSize: '13px',
    lineHeight: '1.6',
    minHeight: '40px',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginTop: '12px',
    gap: '8px',
  },
  advanceBtn: (enabled: boolean) => ({
    background: enabled ? '#6366f1' : '#2a2a45',
    color: enabled ? '#fff' : '#555',
    border: 'none',
    borderRadius: '6px',
    padding: '6px 16px',
    cursor: enabled ? 'pointer' : 'default',
    fontFamily: 'monospace',
    fontSize: '11px',
    fontWeight: 'bold' as const,
  }),
  waitHint: {
    color: '#6366f1',
    fontSize: '10px',
    fontStyle: 'italic' as const,
    alignSelf: 'center' as const,
  },
  skipBtn: {
    background: 'none',
    border: 'none',
    color: '#666',
    fontSize: '10px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    padding: '4px 8px',
  },
};

function RotatingCapsule() {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.rotation.y += 0.008;
    }
  });

  return (
    <mesh ref={meshRef} position={[0, -0.5, 0]}>
      <capsuleGeometry args={[0.38, 0.9, 12, 24]} />
      <meshStandardMaterial color="#9ca3af" emissive="#6366f1" emissiveIntensity={0.15} />
    </mesh>
  );
}

function CapsulePortrait() {
  return (
    <Canvas
      camera={{ position: [0, 0.2, 2.4], fov: 50 }}
      style={{ width: '100%', height: '100%', background: 'transparent' }}
      gl={{ alpha: true }}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 3, 2]} intensity={0.9} />
      <directionalLight position={[-1, 1, -1]} intensity={0.3} />
      <RotatingCapsule />
    </Canvas>
  );
}

function TypewriterText({ text }: { text: string }) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);
  const indexRef = useRef(0);

  useEffect(() => {
    setDisplayed('');
    setDone(false);
    indexRef.current = 0;

    const interval = setInterval(() => {
      indexRef.current++;
      if (indexRef.current >= text.length) {
        setDisplayed(text);
        setDone(true);
        clearInterval(interval);
      } else {
        setDisplayed(text.slice(0, indexRef.current));
      }
    }, 25);

    return () => clearInterval(interval);
  }, [text]);

  return (
    <span>
      {displayed}
      {!done && <span style={{ opacity: 0.5 }}>|</span>}
    </span>
  );
}

const keycap: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '38px',
  height: '38px',
  background: 'linear-gradient(180deg, #3a3a5c 0%, #2a2a45 100%)',
  border: '2px solid #555577',
  borderBottom: '3px solid #444466',
  borderRadius: '6px',
  color: '#e2e8f0',
  fontSize: '14px',
  fontWeight: 'bold',
  fontFamily: 'monospace',
  boxShadow: '0 2px 4px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.08)',
};

const keycapSmall: React.CSSProperties = {
  ...keycap,
  width: '52px',
  fontSize: '10px',
};

function CameraControlsChecklist({ onComplete }: { onComplete: () => void }) {
  const [wasd, setWasd] = useState(false);
  const [drag, setDrag] = useState(false);
  const [scroll, setScroll] = useState(false);
  const doneRef = useRef(false);

  // Check completion
  useEffect(() => {
    if (wasd && drag && scroll && !doneRef.current) {
      doneRef.current = true;
      // Small delay so the user sees the last check tick
      setTimeout(onComplete, 400);
    }
  }, [wasd, drag, scroll, onComplete]);

  useEffect(() => {
    let dragStart = false;

    const onKey = (e: KeyboardEvent) => {
      if (['w', 'a', 's', 'd'].includes(e.key.toLowerCase())) setWasd(true);
    };
    const onMouseDown = (e: MouseEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'BUTTON' || tag === 'INPUT') return;
      dragStart = true;
    };
    const onMouseUp = () => {
      if (dragStart) {
        setDrag(true);
        dragStart = false;
      }
    };
    const onWheel = () => setScroll(true);

    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('wheel', onWheel);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('wheel', onWheel);
    };
  }, []);

  const checkStyle = (done: boolean): React.CSSProperties => ({
    color: done ? '#4ade80' : '#555',
    fontSize: '13px',
    marginRight: '6px',
    transition: 'color 0.2s',
  });

  const rowStyle = (done: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '6px 0',
    opacity: done ? 0.5 : 1,
    transition: 'opacity 0.3s',
  });

  return (
    <div style={{ marginTop: '12px' }}>
      <div style={rowStyle(wasd)}>
        <span style={checkStyle(wasd)}>{wasd ? '\u2713' : '\u2610'}</span>
        <div style={{ display: 'flex', gap: '3px' }}>
          <span style={{ ...keycap, width: '26px', height: '26px', fontSize: '11px' }}>W</span>
          <span style={{ ...keycap, width: '26px', height: '26px', fontSize: '11px' }}>A</span>
          <span style={{ ...keycap, width: '26px', height: '26px', fontSize: '11px' }}>S</span>
          <span style={{ ...keycap, width: '26px', height: '26px', fontSize: '11px' }}>D</span>
        </div>
        <span style={{ color: '#a0aec0', fontSize: '11px' }}>Move camera</span>
      </div>

      <div style={rowStyle(drag)}>
        <span style={checkStyle(drag)}>{drag ? '\u2713' : '\u2610'}</span>
        <div
          style={{
            width: '22px',
            height: '30px',
            border: '1.5px solid #555577',
            borderRadius: '7px',
            position: 'relative',
            background: 'linear-gradient(180deg, #3a3a5c 0%, #2a2a45 100%)',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: '50%',
              width: '1px',
              height: '13px',
              background: '#555577',
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: '5px',
              left: '50%',
              transform: 'translateX(-50%)',
              width: '4px',
              height: '6px',
              border: '1px solid #888',
              borderRadius: '2px',
            }}
          />
        </div>
        <span style={{ color: '#a0aec0', fontSize: '11px' }}>Click and drag to rotate</span>
      </div>

      <div style={rowStyle(scroll)}>
        <span style={checkStyle(scroll)}>{scroll ? '\u2713' : '\u2610'}</span>
        <span style={{ ...keycapSmall, width: '40px', height: '26px', fontSize: '9px' }}>
          Scroll
        </span>
        <span style={{ color: '#a0aec0', fontSize: '11px' }}>Scroll to zoom</span>
      </div>
    </div>
  );
}

export function OnboardingDialogue({ step, onAdvance }: OnboardingDialogueProps) {
  const dialogue = DIALOGUE[step];
  const [lineIndex, setLineIndex] = useState(0);
  const [textDone, setTextDone] = useState(false);
  const [prevStep, setPrevStep] = useState(step);

  // Reset state synchronously during render when step changes (no effect needed)
  if (prevStep !== step) {
    setPrevStep(step);
    setLineIndex(0);
    setTextDone(false);
  }

  const currentText = dialogue.lines[lineIndex] ?? '';

  // Track when typewriter finishes for current line
  useEffect(() => {
    setTextDone(false);
    const timer = setTimeout(() => setTextDone(true), currentText.length * 25 + 100);
    return () => clearTimeout(timer);
  }, [currentText]);

  const isLastLine = lineIndex >= dialogue.lines.length - 1;
  const willWait = isLastLine && dialogue.waitForAction;
  const canAdvance = textDone && !willWait;

  const handleNext = () => {
    if (!canAdvance) return;
    if (!isLastLine) {
      setLineIndex((i) => i + 1);
    } else {
      onAdvance();
    }
  };

  // Button label is stable per line — only depends on position, not textDone
  const buttonLabel = willWait
    ? 'waiting...'
    : isLastLine
      ? step === 'outro'
        ? 'Got it'
        : 'Next'
      : '...';

  return (
    <>
      <div style={S.container}>
        <div style={S.portrait}>
          <CapsulePortrait />
        </div>
        <div style={S.box}>
          <div style={S.nameTag}>OFFICE MANAGER</div>
          <div style={S.text}>
            <TypewriterText key={`${step}-${lineIndex}`} text={currentText} />
          </div>
          {step === 'camera_controls' && <CameraControlsChecklist onComplete={onAdvance} />}
          <div style={S.footer}>
            <button
              style={
                { ...S.skipBtn, visibility: willWait ? 'visible' : 'hidden' } as React.CSSProperties
              }
              onClick={onAdvance}
            >
              skip
            </button>
            <button style={S.advanceBtn(canAdvance)} onClick={handleNext} disabled={!canAdvance}>
              {buttonLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
