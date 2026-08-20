type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
};

type FullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

export function requestFullscreen(element: HTMLElement): Promise<void> {
  const candidate = element as FullscreenElement;

  if (candidate.requestFullscreen) {
    return candidate.requestFullscreen();
  }

  if (candidate.webkitEnterFullscreen) {
    candidate.webkitEnterFullscreen();
    return Promise.resolve();
  }

  if (candidate.webkitRequestFullscreen) {
    return Promise.resolve(candidate.webkitRequestFullscreen());
  }

  return Promise.reject(new Error("Fullscreen is not supported."));
}

export function exitFullscreen(element?: HTMLElement): Promise<void> {
  const candidate = document as FullscreenDocument;
  const video = element as FullscreenElement | undefined;

  if (video?.webkitExitFullscreen) {
    video.webkitExitFullscreen();
    return Promise.resolve();
  }

  if (candidate.exitFullscreen) {
    return candidate.exitFullscreen();
  }

  if (candidate.webkitExitFullscreen) {
    return Promise.resolve(candidate.webkitExitFullscreen());
  }

  return Promise.resolve();
}

export function getFullscreenElement(): Element | null {
  const candidate = document as FullscreenDocument;

  return document.fullscreenElement ?? candidate.webkitFullscreenElement ?? null;
}