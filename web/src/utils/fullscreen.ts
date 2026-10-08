type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  mozRequestFullScreen?: () => Promise<void> | void;
};

type FullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  mozCancelFullScreen?: () => Promise<void> | void;
  mozFullScreenElement?: Element | null;
  mozFullScreenEnabled?: boolean;
};

export function isElementFullscreenSupported(): boolean {
  const candidate = document as FullscreenDocument;

  return Boolean(
    document.fullscreenEnabled
      || candidate.webkitFullscreenEnabled
      || candidate.mozFullScreenEnabled,
  );
}

export function requestFullscreen(element: HTMLElement): Promise<void> {
  const candidate = element as FullscreenElement;

  if (candidate.requestFullscreen) {
    return candidate.requestFullscreen();
  }

  if (candidate.mozRequestFullScreen) {
    return Promise.resolve(candidate.mozRequestFullScreen());
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

export function requestVideoFullscreen(video: HTMLVideoElement): Promise<void> {
  const candidate = video as FullscreenElement;

  if (candidate.webkitEnterFullscreen) {
    candidate.webkitEnterFullscreen();
    return Promise.resolve();
  }

  if (candidate.mozRequestFullScreen) {
    return Promise.resolve(candidate.mozRequestFullScreen());
  }

  return requestFullscreen(video);
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

  if (candidate.mozCancelFullScreen) {
    return Promise.resolve(candidate.mozCancelFullScreen());
  }

  return Promise.resolve();
}

export function getFullscreenElement(): Element | null {
  const candidate = document as FullscreenDocument;

  return document.fullscreenElement
    ?? candidate.webkitFullscreenElement
    ?? candidate.mozFullScreenElement
    ?? null;
}
