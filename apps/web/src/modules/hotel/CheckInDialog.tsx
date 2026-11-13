import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileDrop } from '@/components/file-drop';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import type { Room } from '@/modules/hosp/api';
import type { Uploaded } from '@/lib/upload';
import { send, useHotelMutation, type StayRow } from './api';

const FORM_C = [
  'passportNo',
  'visaNo',
  'visaExpiry',
  'arrivedIndiaOn',
  'arrivedFrom',
  'nextDestination',
  'purpose',
];

/** Check a guest in: the room, the ID with its photo, the signature; a foreign guest's Form C details. */
export function CheckInDialog({
  stay,
  rooms,
  onClose,
}: {
  stay: StayRow;
  rooms: Room[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [roomId, setRoomId] = useState(stay.roomId ?? '');
  const [idType, setIdType] = useState('Aadhaar');
  const [idNumber, setIdNumber] = useState('');
  const [nationality, setNationality] = useState('Indian');
  const [address, setAddress] = useState('');
  const [photo, setPhoto] = useState<Uploaded[]>([]);
  const [sign, setSign] = useState<Uploaded[]>([]);
  const [formC, setFormC] = useState<Record<string, string>>({});
  const foreign = !['indian', 'india', 'in', ''].includes(nationality.trim().toLowerCase());
  const checkIn = useHotelMutation(
    () =>
      send<{ room: string }>(`/api/hotel/stays/${stay.id}/check-in`, {
        roomId: roomId || undefined,
        kyc: {
          idType,
          idNumber,
          nationality,
          address: address || null,
          idPhotoId: photo[0]?.id ?? null,
          signatureId: sign[0]?.id ?? null,
          ...(foreign ? Object.fromEntries(Object.entries(formC).filter(([, v]) => v)) : {}),
        },
      }),
    (r) => t('hotel.checkedIn', { room: r.room }),
  );
  // Rooms of the booked type first; any room may be given (an upgrade).
  const sorted = [...rooms].sort(
    (a, b) => Number(b.typeId === stay.roomTypeId) - Number(a.typeId === stay.roomTypeId),
  );
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={t('hotel.checkInTitle', { name: stay.guest?.name ?? '', number: stay.number })}
      footer={
        <Button
          variant="primary"
          disabled={
            !roomId || idNumber.trim().length < 3 || !photo.length || !sign.length || checkIn.isPending
          }
          onClick={() => checkIn.mutate(undefined, { onSuccess: onClose })}
        >
          {t('hotel.checkIn')}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('hotel.room')}>
            <Select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              <option value="">{t('hotel.chooseRoom')}</option>
              {sorted.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.number}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('hotel.nationality')}>
            <Input value={nationality} onChange={(e) => setNationality(e.target.value)} />
          </Field>
          <Field label={t('hotel.idType')}>
            <Input value={idType} onChange={(e) => setIdType(e.target.value)} />
          </Field>
          <Field label={t('hotel.idNumber')}>
            <Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
          </Field>
        </div>
        <Field label={t('hotel.address')}>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        {foreign && (
          <fieldset className="space-y-3 rounded-control border p-3">
            <legend className="px-1 text-sm font-medium">{t('hotel.formC')}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {FORM_C.map((k) => (
                <Field key={k} label={t(`hotel.formCField.${k}`)}>
                  {k === 'visaExpiry' || k === 'arrivedIndiaOn' ? (
                    <DateInput
                      value={formC[k] ?? ''}
                      onChange={(v) => setFormC((x) => ({ ...x, [k]: v }))}
                      aria-label={t(`hotel.formCField.${k}`)}
                    />
                  ) : (
                    <Input
                      value={formC[k] ?? ''}
                      onChange={(e) => setFormC((x) => ({ ...x, [k]: e.target.value }))}
                    />
                  )}
                </Field>
              ))}
            </div>
          </fieldset>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 text-sm font-medium">{t('hotel.idPhoto')}</div>
            <FileDrop
              files={photo}
              onChange={setPhoto}
              accept="image/*,application/pdf"
              pasteTarget={false}
            />
          </div>
          <div>
            <div className="mb-1.5 text-sm font-medium">{t('hotel.signature')}</div>
            <FileDrop files={sign} onChange={setSign} accept="image/*,application/pdf" pasteTarget={false} />
          </div>
        </div>
      </div>
    </Dialog>
  );
}
