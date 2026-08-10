import { useState } from 'react';
import { api } from '../../lib/api';
import { Button, Input, Modal } from '../uikit';

/** Typed-email confirmation for the cascade tenant delete. Shared by list + detail. */
export function DeleteTenantModal({ open, onClose, tenantId, primaryEmail, userCount, onDeleted }: {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  primaryEmail: string;
  userCount: number;
  onDeleted: () => void;
}) {
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const close = () => { setConfirmText(''); setError(''); onClose(); };
  const confirmed = confirmText.trim().toLowerCase() === primaryEmail.toLowerCase();

  const doDelete = async () => {
    setDeleting(true);
    setError('');
    try {
      await api.adminDeleteTenant(tenantId);
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
      setDeleting(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title={userCount > 1 ? `Delete ${userCount} users?` : 'Delete this user?'}>
      <p className="text-[13.5px] text-content-secondary leading-[1.55]">
        This permanently deletes <b className="text-content">{primaryEmail}</b>
        {userCount > 1 && <> and the {userCount - 1} other {userCount - 1 === 1 ? 'user' : 'users'} in this tenant,</>}
        {' '}and all their data. Type the email to confirm.
      </p>
      {/* Form so Enter submits once the typed email matches — consistent with the edit cards. */}
      <form onSubmit={(e) => { e.preventDefault(); if (confirmed && !deleting) void doDelete(); }}>
        <Input
          className="mt-3"
          autoFocus
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="Type the email to confirm"
          aria-label="Type the email to confirm deletion"
        />
        {error && <p className="mt-2 text-[12.5px] text-negative">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={close}>Cancel</Button>
          <Button
            type="submit"
            size="sm"
            disabled={!confirmed || deleting}
            className="!bg-negative !text-white"
          >
            {deleting ? 'Deleting…' : 'Delete permanently'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
