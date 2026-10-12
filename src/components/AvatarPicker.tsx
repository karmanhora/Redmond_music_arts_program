import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { Alert, Avatar, Button, ConfirmSheet, cn, useToast } from "./ui";
import {
  AVATAR_ACCEPT_ATTR,
  deleteAvatarObject,
  forgetAvatarUrl,
  prepareAvatar,
  uploadAvatar,
} from "../lib/avatar";
import type { PreparedAvatar } from "../lib/avatar";
import { updateMyProfile } from "../lib/queries";
import type { Profile } from "../lib/types";

/**
 * Change your picture: choose a file, see exactly what will be stored, then
 * save. The stored image is a 512px square WebP built from the file (see
 * `lib/avatar.ts`), so what the preview shows is what lands in the bucket.
 *
 * The old object is deleted only *after* the profile row points at the new one —
 * if the upload fails, the picture that was working stays untouched. Storage
 * policies mean this control can only ever write to the caller's own folder, so
 * the buttons are convenience, not the boundary.
 */
export type AvatarPickerHandle = {
  save: () => Promise<boolean>;
};

type AvatarPickerProps = {
  profile: Profile;
  authUserId: string;
  onSaved: () => Promise<void> | void;
  onPendingChange: (pending: boolean) => void;
  className?: string;
};

export const AvatarPicker = forwardRef<AvatarPickerHandle, AvatarPickerProps>(function AvatarPicker(
  { profile, authUserId, onSaved, onPendingChange, className },
  ref
) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PreparedAvatar | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The preview is only ever the freshly-cropped blob; the stored picture is
  // resolved through a signed URL by `Avatar` itself, like everywhere else.
  const name = profile.display_name || profile.full_name || "Member";

  useEffect(
    () => () => {
      if (pending) URL.revokeObjectURL(pending.previewUrl);
    },
    [pending]
  );

  useEffect(() => {
    onPendingChange(pending !== null);
  }, [onPendingChange, pending]);

  async function choose(file: File | undefined) {
    if (!file) return;
    setError(null);
    setReading(true);
    const result = await prepareAvatar(file);
    setReading(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setPending((previous) => {
      if (previous) URL.revokeObjectURL(previous.previewUrl);
      return result.prepared;
    });
  }

  async function save() {
    if (!pending) return false;
    setSaving(true);
    setError(null);

    const uploaded = await uploadAvatar(authUserId, pending);
    if ("error" in uploaded) {
      setSaving(false);
      setError(uploaded.error);
      return false;
    }

    const previousPath = profile.avatar_path;
    const { error: writeError } = await updateMyProfile(profile.id, {
      avatar_path: uploaded.path,
      // An upload supersedes any legacy external URL.
      avatar_url: "",
    });

    if (writeError) {
      setSaving(false);
      setError(`Couldn't save your picture: ${writeError.message}`);
      // The object exists but nothing points at it — clean it up.
      void deleteAvatarObject(uploaded.path);
      return false;
    }

    // The row is safely pointing at the new object, so the old one can go.
    if (previousPath) {
      forgetAvatarUrl(previousPath);
      const cleanupError = await deleteAvatarObject(previousPath);
      if (cleanupError) {
        // Not fatal: the old object is now unreachable, and the owner is the
        // only person who could read it. Say so rather than hiding it.
        toast.warn("Saved, but the old picture couldn't be removed.");
      }
    }

    URL.revokeObjectURL(pending.previewUrl);
    setPending(null);
    setSaving(false);
    return true;
  }

  useImperativeHandle(ref, () => ({ save }), [save]);

  async function remove() {
    setRemoving(true);
    setError(null);
    const previousPath = profile.avatar_path;

    const { error: writeError } = await updateMyProfile(profile.id, { avatar_path: "" });
    if (writeError) {
      setRemoving(false);
      setConfirmRemove(false);
      setError(`Couldn't remove your picture: ${writeError.message}`);
      return;
    }

    if (previousPath) {
      forgetAvatarUrl(previousPath);
      await deleteAvatarObject(previousPath);
    }
    setRemoving(false);
    setConfirmRemove(false);
    toast.success("Your picture was removed.");
    await onSaved();
  }

  return (
    <div className={cn("space-y-3", className)}>
      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="flex items-center gap-4">
        {pending ? (
          <img
            src={pending.previewUrl}
            alt="Preview of your new picture"
            width={72}
            height={72}
            className="shrink-0 rounded-full object-cover ring-2 ring-band"
          />
        ) : (
          <Avatar name={name} path={profile.avatar_path} url={profile.avatar_url} size={72} />
        )}

        <div className="min-w-0 flex-1 space-y-2">
          <input
            ref={input}
            type="file"
            accept={AVATAR_ACCEPT_ATTR}
            className="sr-only"
            aria-label="Choose a profile picture"
            onChange={(event) => {
              void choose(event.target.files?.[0]);
              // Allow re-choosing the same file after a failed attempt.
              event.target.value = "";
            }}
          />

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={reading}
              disabled={saving}
              icon={<ImagePlus className="h-4 w-4" />}
              onClick={() => input.current?.click()}
            >
              {profile.avatar_path || pending ? "Choose another" : "Upload a picture"}
            </Button>

            {pending ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={() => {
                  URL.revokeObjectURL(pending.previewUrl);
                  setPending(null);
                }}
              >
                Cancel
              </Button>
            ) : profile.avatar_path ? (
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 className="h-4 w-4" />}
                onClick={() => setConfirmRemove(true)}
              >
                Remove
              </Button>
            ) : null}
          </div>

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {pending
              ? "Cropped square and resized before saving — nothing larger than 512px is stored."
              : "JPEG, PNG or WebP, up to 5 MB. Pictures are stored privately and shown only to people who can already see your profile."}
          </p>
        </div>
      </div>

      {saving ? (
        <p className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…
        </p>
      ) : null}

      <ConfirmSheet
        open={confirmRemove}
        title="Remove your picture?"
        body="Your picture is deleted and your initials are shown instead. You can upload a new one at any time."
        confirmLabel="Remove picture"
        loading={removing}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => void remove()}
      />
    </div>
  );
});
