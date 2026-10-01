import { useState, useEffect, useRef } from 'react';
import type { ObserverEvent } from '../services/api';
import { palette } from '../theme';

interface DecipherTerminalProps {
  events: ObserverEvent[];
  runStatus: 'idle' | 'running' | 'completed' | 'failed';
}

export default function DecipherTerminal({ events, runStatus }: DecipherTerminalProps) {
  const latestEvent = events[events.length - 1];
  const [decryptedText, setDecryptedText] = useState('');
  const [scrambledText, setScrambledText] = useState('');
  const [driftVal, setDriftVal] = useState(0.0);
  const [oscilloscopePhase, setOscilloscopePhase] = useState(0);
  const animRef = useRef<number | null>(null);

  // Animate the oscilloscope wave based on the drift score
  useEffect(() => {
    let active = true;
    const animateWave = () => {
      if (!active) return;
      setOscilloscopePhase(p => (p + 0.15) % (Math.PI * 2));
      animRef.current = requestAnimationFrame(animateWave);
    };
    animRef.current = requestAnimationFrame(animateWave);
    return () => {
      active = false;
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, []);

  // Sync and interpolate the drift score to show in the meter
  useEffect(() => {
    if (latestEvent) {
      setDriftVal(latestEvent.drift_score);
    } else {
      setDriftVal(0.0);
    }
  }, [latestEvent]);

  // Cypher Decryption effect when a new event arrives
  useEffect(() => {
    if (!latestEvent) {
      setDecryptedText('');
      setScrambledText('');
      return;
    }

    const textToDecrypt = latestEvent.raw_message.slice(0, 140) + (latestEvent.raw_message.length > 140 ? '...' : '');
    setDecryptedText(textToDecrypt);

    // Start fully scrambled
    const chars = '░▒▓██▓▒░01010101ABCDEFGHIJKLMNOPQRSTUVWXYZ#@$%&*+=?';
    let iteration = 0;
    const interval = setInterval(() => {
      setScrambledText(
        textToDecrypt
          .split('')
          .map((char, index) => {
            if (char === ' ') return ' ';
            if (index < iteration) {
              return textToDecrypt[index]; // Decrypted
            }
            return chars[Math.floor(Math.random() * chars.length)]; // Scrambled
          })
          .join('')
      );

      if (iteration >= textToDecrypt.length) {
        clearInterval(interval);
      }
      iteration += 3;
    }, 40);

    return () => clearInterval(interval);
  }, [latestEvent]);

  // Render SVG Oscilloscope Path
  const getOscilloscopePath = () => {
    const width = 280;
    const height = 45;
    const points: string[] = [];
    
    // Wave parameters driven by live telemetry drift
    const driftFactor = Math.max(0.1, driftVal);
    const amp = runStatus === 'running' ? 8 + driftFactor * 15 : 4;
    const freq = runStatus === 'running' ? 0.08 + driftFactor * 0.15 : 0.04;

    for (let x = 0; x <= width; x += 3) {
      const y = height / 2 + Math.sin(x * freq + oscilloscopePhase) * amp;
      points.push(`${x},${y}`);
    }
    return `M ${points.join(' L ')}`;
  };

  const isWarning = driftVal > 0.35 && driftVal <= 0.7;
  const isCritical = driftVal > 0.7;
  const telemetryColor = isCritical ? palette.goldBright : isWarning ? palette.gold : palette.silver;

  return (
    <div 
      className="card telemetry-console"
      style={{ 
        marginTop: 20, 
        padding: '16px 20px', 
        borderColor: telemetryColor, 
        borderWidth: latestEvent ? 1 : 1,
        transition: 'border-color 0.4s ease, box-shadow 0.4s ease',
        boxShadow: latestEvent ? `0 0 12px ${telemetryColor}15` : 'none',
      }}
    >
      {/* Left side: Oscilloscope & Telemetry Meter */}
      <div className="telemetry-meter">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: '0.68rem', fontFamily: 'monospace', color: '#92999F' }}>
            [ DRIFT TELEMETRY OSCILLOSCOPE ]
          </span>
          {runStatus === 'running' && (
            <span style={{ fontSize: '0.62rem', color: palette.goldBright, animation: 'blink 1s infinite', fontWeight: 'bold' }}>
              ● LIVE
            </span>
          )}
        </div>

        {/* Wave display */}
        <div style={{ background: '#0A0B0C', border: '1px solid rgba(184,191,197,0.16)', height: 45, width: '100%', maxWidth: 280, position: 'relative', overflow: 'hidden' }}>
          <svg style={{ width: '100%', height: '100%' }}>
            <path
              d={getOscilloscopePath()}
              fill="none"
              stroke={telemetryColor}
              strokeWidth={1.5}
              style={{ transition: 'stroke 0.4s ease' }}
            />
          </svg>
          {/* Subtle grid lines */}
          <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, borderTop: '1px dashed rgba(184,191,197,0.14)' }} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontFamily: 'monospace', fontSize: '0.72rem' }}>
          <div>
            <span style={{ color: 'rgba(255,255,255,0.45)' }}>DRIFT: </span>
            <span style={{ color: telemetryColor, fontWeight: 'bold' }}>{driftVal.toFixed(4)}</span>
          </div>
          <div>
            <span style={{ color: 'rgba(255,255,255,0.45)' }}>CONF: </span>
            <span style={{ color: telemetryColor, fontWeight: 'bold' }}>
              {latestEvent ? `${(latestEvent.injection_confidence * 100).toFixed(0)}%` : '0%'}
            </span>
          </div>
        </div>
      </div>

      {/* Right side: Scrambled Cypher Decryptor Text */}
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: '0.68rem', fontFamily: 'monospace', color: '#92999F' }}>
            [ INTER-AGENT BOUNDARY DECRYPTOR ]
          </span>
          {latestEvent && (
            <span style={{ fontSize: '0.68rem', fontFamily: 'monospace', color: telemetryColor }}>
              {latestEvent.sender_node} ➔ {latestEvent.receiver_node}
            </span>
          )}
        </div>

        <div 
          style={{ 
            fontFamily: 'monospace', 
            fontSize: '0.76rem', 
            lineHeight: '1.3',
            background: 'rgba(0,0,0,0.5)',
            border: '1px solid rgba(184, 191, 197, 0.12)',
            padding: '8px 12px',
            minHeight: 52,
            color: isCritical ? palette.goldBright : isWarning ? palette.gold : palette.white,
            letterSpacing: '0.3px',
            wordBreak: 'break-all'
          }}
        >
          {runStatus === 'idle' && (
            <span style={{ color: '#92999F' }}>
              &gt; SYSTEM BOUNDARIES IDLE. WAITING FOR PIPELINE TRAFFIC...
            </span>
          )}
          {runStatus === 'running' && !latestEvent && (
            <span style={{ color: palette.gold, animation: 'blink 1.2s infinite' }}>
              &gt; INITIALIZING STREAM CAPTURE BOUNDARIES...
            </span>
          )}
          {latestEvent && scrambledText}
        </div>
      </div>
    </div>
  );
}
