import { useEffect, useRef, useState } from "react";
import { Alert, Button, Field, Input, Textarea, useToast } from "./ui";
import { AvatarPicker } from "./AvatarPicker";
import type { AvatarPickerHandle } from "./AvatarPicker";
import { updateMyProfile } from "../lib/queries";
import type { Profile } from "../lib/types";

const BIO_LIMIT = 500;

/**
 * The one place a profile is edited — used both on the profile screen and in
 * Account settings, so the two can never drift.
 *
 * It only sends the fields the owner is allowed to set. The database is what
 * makes that true: `profiles_update_scoped` limits the write to your own row,
 * and `guard_profile_self_update` refuses `deactivated` from anybody who cannot
 * already manage the account. A hand-crafted request that adds a role column
 * would simply be ignored — those columns do not exist here.
 */
export function ProfileForm({
  profile,
  authUserId,
  onSaved,
}: {
  profile: Profile;
  authUserId: string;
  onSaved: () => Promise<void> | void;
}) {
  const { toast } = useToast();
  const [fullName, setFullName] = useState(profile.full_name);
  const [displayName, setDisplayName] = useState(profile.display_name);
  const [bio, setBio] = useState(profile.bio ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [avatarPending, setAvatarPending] = useState(false);
  const avatarPicker = useRef<AvatarPickerHandle>(null);

  // Re-sync when the loaded profile changes (a save elsewhere, a program switch).
  useEffect(() => {
    setFullName(profile.full_name);
    setDisplayName(profile.display_name);
    setBio(profile.bio ?? "");
  }, [profile.id, profile.full_name, profile.display_name, profile.bio]);

  const dirty =
    fullName !== profile.full_name ||
    displayName !== profile.display_name ||
    bio !== (profile.bio ?? "");

  async function save() {
    if (dirty) {
      if (!fullName.trim()) {
        setError("Your name can't be empty.");
        return;
      }
      if (bio.length > BIO_LIMIT) {
        setError(`Keep your biography under ${BIO_LIMIT} characters.`);
        return;
      }
    }

    setSaving(true);
    setError(null);

    if (dirty) {
      const { error: writeError } = await updateMyProfile(profile.id, {
        full_name: fullName.trim(),
        display_name: displayName.trim(),
        bio: bio.trim(),
      });

      if (writeError) {
        setSaving(false);
        setError(writeError.message);
        return;
      }
    }

    if (avatarPending) {
      const avatarSaved = (await avatarPicker.current?.save()) ?? false;
      if (!avatarSaved) {
        setSaving(false);
        if (dirty) await onSaved();
        return;
      }
    }

    setSaving(false);
    toast.success("Changes saved.");
    await onSaved();
  }

  return (
    <div className="space-y-5">
      {error ? <Alert tone="error">{error}</Alert> : null}

      <AvatarPicker
        ref={avatarPicker}
        profile={profile}
        authUserId={authUserId}
        onSaved={onSaved}
        onPendingChange={setAvatarPending}
      />

      <div className="space-y-4 border-t border-[var(--cue-border)] pt-4">
        <Field label="Full name" hint="Your director sees this on the roster.">
          <Input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="Alex Rivera"
            autoComplete="name"
            maxLength={80}
          />
        </Field>

        <Field label="Display name" hint="Optional — what the app shows everywhere.">
          <Input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Alex"
            maxLength={80}
          />
        </Field>

        <Field
          label="About you"
          hint={`Optional. ${Math.max(0, BIO_LIMIT - bio.length)} characters left — a line or two anyone in your program can read.`}
        >
          <Textarea
            value={bio}
            onChange={(event) => setBio(event.target.value.slice(0, BIO_LIMIT))}
            placeholder="Section leader, second year, plays trumpet."
            rows={3}
          />
        </Field>
      </div>

      <div className="flex items-center gap-2">
        <Button loading={saving} disabled={!dirty && !avatarPending} onClick={() => void save()}>
          Save changes
        </Button>
        {dirty ? (
          <Button
            variant="ghost"
            disabled={saving}
            onClick={() => {
              setFullName(profile.full_name);
              setDisplayName(profile.display_name);
              setBio(profile.bio ?? "");
              setError(null);
            }}
          >
            Undo
          </Button>
        ) : null}
      </div>
    </div>
  );
}
