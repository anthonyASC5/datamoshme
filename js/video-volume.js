function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setOutputValue(output, value) {
  if (!output) {
    return;
  }

  output.value = value;
  output.textContent = value;
}

export function createVideoVolumeController({
  media,
  slider,
  output,
  toggleButton,
  defaultVolume = 1,
  unavailableOutput = "N/A",
  unavailableLabel = "No Audio",
  muteLabel = "Mute Audio",
  unmuteLabel = "Unmute Audio",
}) {
  let available = false;
  let volume = clamp(defaultVolume, 0, 1);
  let lastAudibleVolume = volume > 0 ? volume : 1;

  function isMuted() {
    return volume <= 0.001;
  }

  function syncMediaState() {
    if (!media) {
      return;
    }

    media.volume = clamp(volume, 0, 1);
    media.muted = !available || isMuted();
  }

  function syncUi() {
    const percent = Math.round(volume * 100);

    if (slider) {
      slider.disabled = !available;
      slider.value = String(percent);
    }

    setOutputValue(output, available ? `${percent}%` : unavailableOutput);

    if (toggleButton) {
      toggleButton.disabled = !available;
      toggleButton.textContent = available
        ? (isMuted() ? unmuteLabel : muteLabel)
        : unavailableLabel;
      toggleButton.setAttribute("aria-pressed", available && isMuted() ? "true" : "false");
    }
  }

  function setVolume(nextVolume) {
    volume = clamp(nextVolume, 0, 1);
    if (volume > 0.001) {
      lastAudibleVolume = volume;
    }
    syncMediaState();
    syncUi();
  }

  function setAvailable(nextAvailable) {
    available = Boolean(nextAvailable);
    syncMediaState();
    syncUi();
  }

  function toggleMute() {
    if (!available) {
      return;
    }

    if (isMuted()) {
      setVolume(lastAudibleVolume > 0.001 ? lastAudibleVolume : defaultVolume);
      return;
    }

    setVolume(0);
  }

  slider?.addEventListener("input", () => {
    setVolume(Number(slider.value) / 100);
  });

  toggleButton?.addEventListener("click", () => {
    toggleMute();
  });

  syncMediaState();
  syncUi();

  return {
    setAvailable,
    setVolume,
    toggleMute,
    isMuted,
  };
}
