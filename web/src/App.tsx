import { useState } from "react";
import { roomFromPath } from "./utils/room";
import { Landing } from "./components/Landing";
import { NameGate } from "./components/NameGate";
import { Room } from "./components/Room";

export default function App() {
  const roomId = roomFromPath();
  const [name, setName] = useState<string | null>(null);

  if (!roomId) return <Landing />;
  if (!name) return <NameGate roomId={roomId} onJoin={setName} />;
  return <Room roomId={roomId} name={name} />;
}