import { useEffect, useRef } from "react";

type SwitchRoomDialogProps = {
  onStay: () => void;
  onSwitch: () => void;
};

export function SwitchRoomDialog({ onStay, onSwitch }: SwitchRoomDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog ref={dialog} className="switch-room-dialog" aria-labelledby="switch-room-title" aria-describedby="switch-room-description" onCancel={(event) => { event.preventDefault(); onStay(); }}>
      <p className="eyebrow"><span /> Room invitation</p>
      <h1 id="switch-room-title">Switch rooms?</h1>
      <p id="switch-room-description">You will lose access to your current room.</p>
      <div className="switch-room-actions">
        <button className="ghost-button" type="button" onClick={onStay}>Stay in current room</button>
        <button className="primary-button" type="button" onClick={onSwitch}>Switch rooms <span>→</span></button>
      </div>
    </dialog>
  );
}
