import { FormEvent, useEffect, useState } from "react";
import { DeviceRequestError, getDeviceProfile, updateDeviceProfile } from "@golive/core";
import { Brand } from "./Brand";
import { configuredBaseUrl } from "../services/sessionDeps";
import { clearDeviceToken, loadDeviceToken, saveDeviceName } from "../utils/session";

export function DeviceProfile() {
  const [deviceToken, setDeviceToken] = useState(loadDeviceToken);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(Boolean(deviceToken));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!deviceToken) return;
    let cancelled = false;
    void getDeviceProfile(configuredBaseUrl(), deviceToken).then((profile) => {
      if (cancelled) return;
      setName(profile.name);
      saveDeviceName(profile.name);
    }).catch((caught: unknown) => {
      if (cancelled) return;
      if (caught instanceof DeviceRequestError && caught.status === 401) {
        clearDeviceToken();
        setDeviceToken(null);
        setError("This device profile is no longer available. Accept an invite to create a new one.");
      } else {
        setError("Could not load your profile. Check your connection and retry.");
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [deviceToken]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!deviceToken || !trimmed || trimmed.length > 32 || saving) return;
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const profile = await updateDeviceProfile(configuredBaseUrl(), deviceToken, trimmed);
      setName(profile.name);
      saveDeviceName(profile.name);
      setSaved(true);
    } catch (caught) {
      if (caught instanceof DeviceRequestError && caught.status === 401) {
        clearDeviceToken();
        setDeviceToken(null);
        setError("This device profile is no longer available. Accept an invite to create a new one.");
      } else {
        setError("Could not save your name. Please retry.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="account-shell">
      <nav className="account-nav">
        <Brand ariaLabel="GoLive home" />
        <div className="account-nav-links">
          {deviceToken && <a href="/rooms">My rooms</a>}
          <a href="/profile" aria-current="page">Profile</a>
        </div>
      </nav>
      <section className="account-content profile-content">
        <p className="eyebrow"><span /> Device profile</p>
        <h1>Your profile</h1>
        <p className="account-description">This display name follows you into every room on this device.</p>
        {loading ? <p className="account-status" role="status">Loading your profile…</p> : null}
        {!deviceToken ? (
          <div className="account-empty-state">
            <h2>No profile yet</h2>
            <p>Create a room or accept an invite to set up a profile on this device.</p>
            <a className="primary-button" href="/">Go to GoLive <span>→</span></a>
          </div>
        ) : null}
        {!loading && deviceToken ? (
          <form className="profile-form" onSubmit={save}>
            <label htmlFor="profile-name">Display name</label>
            <input
              id="profile-name"
              autoComplete="nickname"
              maxLength={32}
              value={name}
              onChange={(event) => { setName(event.target.value); setSaved(false); }}
              required
            />
            <small>Up to 32 characters. Changes appear in rooms that are already open.</small>
            {error && <p className="account-error" role="alert">{error}</p>}
            {saved && <p className="account-success" role="status">Profile saved.</p>}
            <button className="primary-button" type="submit" disabled={!name.trim() || saving}>
              {saving ? "Saving…" : "Save profile"}
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
