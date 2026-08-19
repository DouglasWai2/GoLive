import { useState } from "react";
import { roomFromPath } from "./utils/room";
import { Landing } from "./components/Landing";
import { NameGate } from "./components/NameGate";
import { Room } from "./components/Room";

type Join = {
  name: string;
  token: string;
};

export default function App() {
  const roomId = roomFromPath();
  const [join, setJoin] = useState<Join | null>(null);

  if (!roomId) return <Landing />;
  if (!join) return <NameGate roomId={roomId} onJoin={(name, token) => setJoin({ name, token })} />;
  return <Room roomId={roomId} name={join.name} token={join.token} />;
}