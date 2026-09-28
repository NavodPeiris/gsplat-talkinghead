import { MicIcon, MicOffIcon, PhoneIcon, PhoneOffIcon } from '../icons';
import { AudioBars } from './AudioBars';
import type { SessionStatus } from '../types';

interface ToolbarProps {
  sessionStatus: SessionStatus;
  onToggleConnection: () => void;
  onToggleMute: () => void;
  isMuted: boolean;
  getMicLevel: () => number;
  getAgentLevel: () => number;
  /** Disables Start (e.g. while assets are still downloading). */
  disabled?: boolean;
}

export function Toolbar({
  sessionStatus,
  onToggleConnection,
  onToggleMute,
  isMuted,
  getMicLevel,
  getAgentLevel,
  disabled = false,
}: ToolbarProps) {
  const isConnected = sessionStatus === 'CONNECTED';
  const isConnecting = sessionStatus === 'CONNECTING';

  return (
    <div className="aa-toolbar" role="toolbar" aria-label="Conversation controls">
      {isConnected ? (
        <>
          <button
            type="button"
            className="aa-btn aa-btn-icon"
            onClick={onToggleMute}
            aria-pressed={isMuted}
            aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <MicOffIcon size={18} /> : <MicIcon size={18} />}
          </button>

          <div className="aa-bars" aria-hidden="true">
            <AudioBars getMicLevel={getMicLevel} getAgentLevel={getAgentLevel} isActive={!isMuted} color="#0f172a" />
          </div>

          <button type="button" className="aa-btn aa-btn-danger" onClick={onToggleConnection}>
            <PhoneOffIcon size={16} />
            End
          </button>
        </>
      ) : (
        <button
          type="button"
          className="aa-btn aa-btn-primary"
          onClick={onToggleConnection}
          disabled={isConnecting || disabled}
          aria-busy={isConnecting}
          title={disabled ? 'Downloading assets…' : undefined}
        >
          {isConnecting ? <span className="aa-spinner" aria-hidden="true" /> : <PhoneIcon size={16} />}
          {isConnecting ? 'Connecting…' : 'Start conversation'}
        </button>
      )}
    </div>
  );
}
