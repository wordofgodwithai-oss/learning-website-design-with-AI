import type { Engine, GenerationKind } from "@/lib/types";
import { bool, clamp, num, str } from "@/lib/http";
import { DURATION_LIMITS } from "@/lib/generation/config";
import { validationError } from "@/lib/generation/errors";
import { languageName } from "@/lib/generation/config";

/**
 * Normalized form of the generate request.
 *
 * Field names follow the multipart vocabulary recovered from the playground
 * bundle (REPORT.md section 6). Fields that only affect the real renderer are
 * preserved in `raw` / `request` so a future backend integration can use them
 * without re-parsing the client.
 */
export interface NormalizedGenerationRequest {
  isAudioOnly: boolean;
  prompt: string;
  kind: GenerationKind;
  engine: Engine;
  style: string;
  imageStyle: string | null;
  penStyle: string | null;
  imageGenerationModel: string;
  useColor: boolean;
  pacing: string;
  timing: string;
  durationSeconds: number;
  language: string;
  displayLanguage: string;
  voiceName: string | null;
  voiceInstructions: string | null;
  avatarRenderer: string | null;
  avatarPresentationMode: string | null;
  characterConsistencyMode: string | null;
  characters: unknown[];
  customScenePreparationId: string | null;
  customSceneSelectionSentences: string[];
  skipAnimation: boolean;
  justReturnScript: boolean;
  scriptOnlyText: string | null;
  newScript: boolean;
  fillIn: boolean;
  isEdit: boolean;
  isPublic: boolean;
  forceWatermark: boolean;
  includeWatermark: boolean;
  organizationId: string | null;
  useOrganizationCredits: boolean;
  customMusicUrl: string | null;
  musicName: string | null;
  logoUrl: string | null;
  logoPlacement: string | null;
  styleReference: string | null;
  mediaFiles: string[];
  mediaFileTypes: string[];
  mediaFileDescriptions: string[];
  mediaFileUseAsIs: boolean[];
  userImages: string[];
  userImagesDescription: string[];
  userVideos: string[];
  userVideosDescription: string[];
  userVideoAvatarModes: string[];
  userAudioInVideo: string | null;
  ownNarration: {
    avatarId: string;
    durationSeconds: number;
    pipPosition: string;
    splitSize: string;
    videoMode: string;
    webcamCropX: string;
    usePreparedNarrationFallback: boolean;
  } | null;
  variantLanguages: string[];
  variantDisplayLanguages: string[];
  variantNewScripts: boolean;
  requestPayload: Record<string, unknown> | null;
  uploadUrls: string[];
  raw: Record<string, unknown>;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => str(entry)).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((entry) => str(entry)).filter(Boolean);
    } catch {
      return value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function boolList(value: unknown): boolean[] {
  return stringList(value).map((entry) => bool(entry));
}

function parseJson(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object") return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * @param fields   multipart text fields (values may be File for uploads, which
 *                 the route has already persisted and replaced with URLs) or a
 *                 JSON body for the v2 API.
 * @param options  uploadUrls collected by the route.
 */
export function normalizeGenerationInput(
  fields: Record<string, unknown>,
  options: { uploadUrls?: string[]; defaultKind?: GenerationKind } = {},
): NormalizedGenerationRequest {
  const requestPayload = parseJson(fields.request_payload);
  // v2 sends a flat JSON body; v1 sends multipart. Fields from request_payload
  // win over multipart fields, matching the client which packs the typed
  // payload separately.
  const merged: Record<string, unknown> = { ...fields, ...(requestPayload ?? {}) };

  const kind: GenerationKind =
    str(merged.kind, options.defaultKind ?? "video") === "podcast" ? "podcast" : "video";

  const engine: Engine =
    str(merged.golpo_video_engine) === "golpo_sketch" ||
    bool(merged.use_lineart_2_style)
      ? "golpo_sketch"
      : "golpo_canvas";

  const sketchStyle = str(merged.sketch_style_variant) || str(merged.pen_style);
  const canvasStyle =
    str(merged.canvas_style_variant) || str(merged.image_style) || str(merged.style);

  const style =
    engine === "golpo_sketch"
      ? sketchStyle || "classic"
      : canvasStyle || "whiteboard";

  const language = str(merged.language, "en") || "en";
  const displayLanguage =
    str(merged.display_language) ||
    str(merged.onscreen_text_language) ||
    languageName(language);

  const rawDuration = num(merged.durationSeconds ?? merged.duration_seconds, 60);
  const durationSeconds = clamp(
    Math.round(rawDuration),
    DURATION_LIMITS.minSeconds,
    DURATION_LIMITS.maxSeconds,
  );

  const isAudioOnly = kind === "podcast" || bool(merged.is_audio_only) || bool(merged.audio_only);

  const ownNarrationAvatar = str(merged.own_narration_avatar_id);
  const ownNarration = ownNarrationAvatar
    ? {
        avatarId: ownNarrationAvatar,
        durationSeconds: num(merged.own_narration_avatar_duration_seconds, 0),
        pipPosition: str(merged.own_narration_pip_position, "bottom_right"),
        splitSize: str(merged.own_narration_split_size, "medium"),
        videoMode: str(merged.own_narration_video_mode, "pip"),
        webcamCropX: str(merged.own_narration_webcam_crop_x, "0"),
        usePreparedNarrationFallback: bool(merged.use_prepared_narration_fallback, true),
      }
    : null;

  const scriptOnlyText = str(merged.script_only_text).trim() || null;

  return {
    prompt: str(merged.prompt).trim(),
    kind,
    engine,
    style,
    isAudioOnly,
    imageStyle: str(merged.image_style) || (engine === "golpo_canvas" ? style : null),
    penStyle: str(merged.pen_style) || (engine === "golpo_sketch" ? style : null),
    imageGenerationModel: str(merged.image_generation_model, "default"),
    useColor: bool(merged.use_color, true),
    pacing: str(merged.pacing, "normal"),
    timing: str(merged.timing, "auto"),
    durationSeconds,
    language,
    displayLanguage,
    voiceName: str(merged.voiceName ?? merged.narration_voice) || null,
    voiceInstructions: str(merged.voice_instructions) || null,
    avatarRenderer: str(merged.avatar_renderer) || null,
    avatarPresentationMode: str(merged.avatar_presentation_mode) || null,
    characterConsistencyMode: str(merged.char_consistency_mode) || null,
    characters: Array.isArray(merged.characters)
      ? merged.characters
      : stringList(merged.characters),
    customScenePreparationId: str(merged.custom_scene_preparation_id) || null,
    customSceneSelectionSentences: stringList(merged.custom_scene_selection_sentences),
    skipAnimation: bool(merged.skip_animation),
    justReturnScript: bool(merged.just_return_script),
    scriptOnlyText,
    newScript: bool(merged.new_script),
    fillIn: bool(merged.fill_in),
    isEdit: bool(merged.is_edit),
    isPublic: bool(merged.is_public) || str(merged.visibility) === "public",
    forceWatermark: bool(merged.force_watermark),
    includeWatermark: bool(merged.include_watermark, bool(merged.watermark, false)),
    organizationId: str(merged.organization_id) || null,
    useOrganizationCredits: bool(merged.use_organization_credits),
    customMusicUrl: str(merged.custom_music_url) || null,
    musicName: str(merged.musicName ?? merged.background_track) || null,
    logoUrl: str(merged.logo_url) || null,
    logoPlacement: str(merged.logo_placement) || null,
    styleReference: str(merged.style_reference) || null,
    mediaFiles: stringList(merged.media_files),
    mediaFileTypes: stringList(merged.media_file_types),
    mediaFileDescriptions: stringList(merged.media_file_descriptions),
    mediaFileUseAsIs: boolList(merged.media_file_use_as_is),
    userImages: stringList(merged.user_images),
    userImagesDescription: stringList(merged.user_images_description),
    userVideos: stringList(merged.user_videos),
    userVideosDescription: stringList(merged.user_videos_description),
    userVideoAvatarModes: stringList(merged.user_video_avatar_modes),
    userAudioInVideo: str(merged.user_audio_in_video) || null,
    ownNarration,
    variantLanguages: stringList(merged.variant_languages),
    variantDisplayLanguages: stringList(merged.variant_display_languages),
    variantNewScripts: bool(merged.variant_new_scripts),
    requestPayload,
    uploadUrls: [...new Set([...(options.uploadUrls ?? []), ...stringList(merged.upload_urls)])],
    raw: merged,
  };

  void isAudioOnly;
}

export function validateGenerationInput(input: NormalizedGenerationRequest): void {
  if (!input.prompt && !input.scriptOnlyText && !input.fillIn) {
    throw validationError(
      "A prompt is required. Describe the video you want, or paste a script.",
    );
  }
  if (input.prompt.length > 8000) {
    throw validationError("Prompt is too long (8000 characters maximum).");
  }
  if (input.variantLanguages.length > 10) {
    throw validationError("A maximum of 10 language variants is supported.");
  }
}
