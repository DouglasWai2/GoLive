import { type FormEvent, useCallback, useEffect, useState } from "react";
import { buildInviteUrl } from "@golive/core";
import {
  AdminApiError, type CatalogRecord, createAdminRoomInvite, createCatalogRecord, deleteCatalogRecord,
  listCatalog, renameCatalogRecord,
} from "../services/adminApi";

type Kind = "rooms" | "profiles";
type Props = { token: string; kind: Kind; onUnauthorized: () => void };

export function CatalogManager({ token, kind, onUnauthorized }: Props) {
  const [records, setRecords] = useState<CatalogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const handleError = useCallback((caught: unknown) => {
    if (caught instanceof AdminApiError && caught.status === 401) {
      onUnauthorized();
      return;
    }
    setError(caught instanceof Error ? caught.message : "Request failed");
  }, [onUnauthorized]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await listCatalog(token, kind, signal);
      if (!signal?.aborted) { setRecords(result); setError(""); }
    } catch (caught) {
      if (!signal?.aborted) handleError(caught);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [token, kind, handleError]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !name.trim() || (kind === "rooms" && !id.trim())) return;
    setBusy(true);
    setError("");
    try {
      await createCatalogRecord(token, kind, kind === "rooms" ? { id: id.trim(), name: name.trim() } : { name: name.trim() });
      setName(""); setId("");
      await refresh();
    } catch (caught) { handleError(caught); }
    finally { setBusy(false); }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing || busy || !editName.trim()) return;
    setBusy(true); setError("");
    try {
      await renameCatalogRecord(token, kind, editing, editName.trim());
      setEditing(null);
      await refresh();
    } catch (caught) { handleError(caught); }
    finally { setBusy(false); }
  };

  const remove = async (record: CatalogRecord) => {
    if (busy || !window.confirm(`Delete ${record.name} (${record.id})?`)) return;
    setBusy(true); setError("");
    try {
      await deleteCatalogRecord(token, kind, record.id);
      if (editing === record.id) setEditing(null);
      await refresh();
    } catch (caught) { handleError(caught); }
    finally { setBusy(false); }
  };

  const invite = async (record: CatalogRecord) => {
    setBusy(true); setError("");
    try {
      const { inviteToken } = await createAdminRoomInvite(token, record.id);
      await navigator.clipboard.writeText(buildInviteUrl(window.location.origin, record.id, inviteToken));
    } catch (caught) { handleError(caught); }
    finally { setBusy(false); }
  };

  const title = kind === "rooms" ? "Saved rooms" : "Guest profiles";
  return (
    <section className="admin-data-section admin-catalog" aria-label={title}>
      <header><h2>{title}</h2><span>{records.length.toLocaleString()} total</span></header>
      <p className="admin-catalog-note">{kind === "rooms"
        ? "Room records remain while at least one device has access. Rooms with members cannot be deleted."
        : "Joined devices appear here. Profiles created by admins have no device credential until enrollment is implemented."}</p>
      <form className="admin-catalog-form" onSubmit={create}>
        {kind === "rooms" && <input aria-label="New room ID" placeholder="Room ID (8–64 letters, digits, _ or -)" value={id} onChange={(event) => setId(event.target.value)} minLength={8} maxLength={64} pattern="[A-Za-z0-9_-]{8,64}" required disabled={busy} />}
        <input aria-label={kind === "rooms" ? "New room name" : "New guest name"} placeholder={kind === "rooms" ? "Room name" : "Guest name"} value={name} onChange={(event) => setName(event.target.value)} maxLength={kind === "rooms" ? 80 : 32} required disabled={busy} />
        <button className="admin-action-button" type="submit" disabled={busy || !name.trim() || (kind === "rooms" && !id.trim())}>Create</button>
      </form>
      {error && <p className="admin-inline-error admin-catalog-error" role="alert">{error}</p>}
      {loading ? <p className="admin-empty-state">Loading records...</p> : records.length ? (
        <div className="admin-table-scroll"><table className="admin-table">
          <thead><tr><th>ID</th><th>Name</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>{records.map((record) => <tr key={record.id}>
            <td><code>{record.id}</code></td>
            <td>{editing === record.id ? (
              <form className="admin-catalog-edit" onSubmit={save}>
                <input aria-label={`Edit ${record.name}`} value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={kind === "rooms" ? 80 : 32} required disabled={busy} />
                <button type="submit" disabled={busy || !editName.trim()}>Save</button>
                <button type="button" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
              </form>
            ) : <strong>{record.name}</strong>}</td>
            <td>{new Date(record.createdAt).toLocaleString()}</td>
            <td className="admin-catalog-actions">
              {kind === "rooms" && <button type="button" disabled={busy} onClick={() => void invite(record)}>Copy invite</button>}
              <button type="button" disabled={busy} onClick={() => { setEditing(record.id); setEditName(record.name); setError(""); }}>Edit</button>
              <button type="button" disabled={busy} onClick={() => void remove(record)}>Delete</button>
            </td>
          </tr>)}</tbody>
        </table></div>
      ) : <p className="admin-empty-state">No {kind === "rooms" ? "saved rooms" : "guest profiles"} yet.</p>}
    </section>
  );
}
