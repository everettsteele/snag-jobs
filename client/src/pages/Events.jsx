import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';

const EVENT_TYPES = {
  coffee_chat: { label: 'Coffee Chat', color: 'bg-amber-100 text-amber-700' },
  conference: { label: 'Conference', color: 'bg-blue-100 text-blue-700' },
  meetup: { label: 'Meetup', color: 'bg-green-100 text-green-700' },
  informational: { label: 'Informational', color: 'bg-purple-100 text-purple-700' },
  interview_prep: { label: 'Interview Prep', color: 'bg-indigo-100 text-indigo-700' },
  networking: { label: 'Networking', color: 'bg-rose-100 text-rose-700' },
  other: { label: 'Other', color: 'bg-gray-100 text-gray-600' },
};

export default function EventsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['events'],
    queryFn: () => api.get('/networking/events'),
  });

  const addMutation = useMutation({
    mutationFn: (evt) => api.post('/networking/events', evt),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      toast('Event added');
      setShowModal(false);
    },
    onError: (err) => toast(err.message, 'error'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...fields }) => api.patch(`/networking/events/${id}`, fields),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
    },
    onError: (err) => toast(err.message, 'error'),
  });

  const addStepMutation = useMutation({
    mutationFn: ({ eventId, text }) =>
      api.post(`/networking/events/${eventId}/steps`, { text }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
    },
    onError: (err) => toast(err.message, 'error'),
  });

  const toggleStepMutation = useMutation({
    mutationFn: ({ eventId, stepId, done }) =>
      api.patch(`/networking/events/${eventId}/steps/${stepId}`, { done }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
    },
    onError: (err) => toast(err.message, 'error'),
  });

  const addContactMutation = useMutation({
    mutationFn: ({ eventId, name, email }) =>
      api.post(`/networking/events/${eventId}/contacts`, { name, email }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      toast('Contact added');
    },
    onError: (err) => toast(err.message, 'error'),
  });

  const syncCalendarMutation = useMutation({
    mutationFn: () => api.post('/google/calendar/sync'),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      toast(`Synced ${data.added} new, ${data.updated} updated`);
    },
    onError: (err) => {
      if (err.message?.includes('not connected')) {
        toast('Connect Google in Settings first', 'error');
      } else {
        toast(err.message, 'error');
      }
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-[#F97316] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-red-600 mb-2">{error.message}</p>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ['events'] })}
          className="text-sm text-[#F97316] hover:underline cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  const eventList = Array.isArray(data) ? data : data?.events || [];
  const now = new Date();
  const visibleEvents = eventList.filter((e) => !e.hidden);
  const hiddenEvents = eventList.filter((e) => e.hidden);
  const upcoming = visibleEvents.filter((e) => new Date(e.date) >= now);
  const past = visibleEvents.filter((e) => new Date(e.date) < now);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-[#1F2D3D]">
          {visibleEvents.length} Event{visibleEvents.length !== 1 ? 's' : ''}
        </h2>
        <div className="flex items-center gap-2">
          {hiddenEvents.length > 0 && (
            <button
              onClick={() => setShowHidden(!showHidden)}
              className="text-sm text-gray-500 hover:text-gray-700 cursor-pointer"
            >
              {showHidden ? 'Hide' : 'Show'} {hiddenEvents.length} hidden
            </button>
          )}
          <button
            onClick={() => syncCalendarMutation.mutate()}
            disabled={syncCalendarMutation.isPending}
            className="text-sm bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            {syncCalendarMutation.isPending ? 'Syncing...' : 'Sync Calendar'}
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="bg-[#F97316] hover:bg-[#EA580C] text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors cursor-pointer"
          >
            + Log Event
          </button>
        </div>
      </div>

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <Section title="Upcoming">
          {upcoming.map((evt) => (
            <EventCard
              key={evt.id}
              event={evt}
              onUpdate={(fields) => updateMutation.mutate({ id: evt.id, ...fields })}
              onAddStep={(text) => addStepMutation.mutate({ eventId: evt.id, text })}
              onToggleStep={(stepId, done) =>
                toggleStepMutation.mutate({ eventId: evt.id, stepId, done })
              }
              onAddContact={(name, email) =>
                addContactMutation.mutate({ eventId: evt.id, name, email })
              }
            />
          ))}
        </Section>
      )}

      {/* Past */}
      {past.length > 0 && (
        <Section title="Past">
          {past.map((evt) => (
            <EventCard
              key={evt.id}
              event={evt}
              onUpdate={(fields) => updateMutation.mutate({ id: evt.id, ...fields })}
              onAddStep={(text) => addStepMutation.mutate({ eventId: evt.id, text })}
              onToggleStep={(stepId, done) =>
                toggleStepMutation.mutate({ eventId: evt.id, stepId, done })
              }
              onAddContact={(name, email) =>
                addContactMutation.mutate({ eventId: evt.id, name, email })
              }
            />
          ))}
        </Section>
      )}

      {/* Hidden Events */}
      {showHidden && hiddenEvents.length > 0 && (
        <Section title="Hidden">
          {hiddenEvents.map((evt) => (
            <EventCard
              key={evt.id}
              event={evt}
              onUpdate={(fields) => updateMutation.mutate({ id: evt.id, ...fields })}
              onAddStep={(text) => addStepMutation.mutate({ eventId: evt.id, text })}
              onToggleStep={(stepId, done) =>
                toggleStepMutation.mutate({ eventId: evt.id, stepId, done })
              }
              onAddContact={(name, email) =>
                addContactMutation.mutate({ eventId: evt.id, name, email })
              }
            />
          ))}
        </Section>
      )}

      {/* Empty state */}
      {visibleEvents.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <p className="text-gray-500">No events yet. Log your first networking event.</p>
        </div>
      )}

      {/* Add Modal */}
      {showModal && (
        <AddEventModal
          onClose={() => setShowModal(false)}
          onSave={(data) => addMutation.mutate(data)}
          saving={addMutation.isPending}
        />
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-[#1F2D3D] uppercase tracking-wide mb-3">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function EventCard({ event, onUpdate, onAddStep, onToggleStep, onAddContact }) {
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState(event.notes || '');
  const [stepText, setStepText] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  const typeInfo = EVENT_TYPES[event.type] || EVENT_TYPES.other;

  const handleNotesBlur = useCallback(() => {
    if (notes !== (event.notes || '')) {
      onUpdate({ notes });
    }
  }, [notes, event.notes, onUpdate]);

  const handleAddStep = (e) => {
    e.preventDefault();
    if (!stepText.trim()) return;
    onAddStep(stepText.trim());
    setStepText('');
  };

  const handleAddContact = (e) => {
    e.preventDefault();
    if (!contactName.trim()) return;
    onAddContact(contactName.trim(), contactEmail.trim());
    setContactName('');
    setContactEmail('');
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div
        className="px-4 py-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-gray-50/50"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-[#1F2D3D]">{event.title}</span>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${typeInfo.color}`}>
              {typeInfo.label}
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {event.date && new Date(event.date).toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
            {event.location && ` \u00B7 ${event.location}`}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUpdate({ hidden: !event.hidden });
            }}
            className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer"
          >
            {event.hidden ? 'Unhide' : 'Hide'}
          </button>
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-4 space-y-4">
          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={handleNotesBlur}
              rows={3}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] resize-none"
              placeholder="Event notes..."
            />
          </div>

          {/* Contacts */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Contacts ({event.contacts?.length || 0})
            </label>
            {event.contacts?.length > 0 && (
              <div className="space-y-1 mb-2">
                {event.contacts.map((c, i) => (
                  <div key={c.id || i} className="flex items-center gap-2 text-sm text-gray-700">
                    <div className="w-6 h-6 bg-[#1F2D3D] text-white rounded-full flex items-center justify-center text-[10px] font-medium shrink-0">
                      {(c.name || '?')[0].toUpperCase()}
                    </div>
                    <span>{c.name}</span>
                    {c.email && <span className="text-xs text-gray-400">{c.email}</span>}
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={handleAddContact} className="flex items-center gap-2">
              <input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className="flex-1 px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#F97316]"
                placeholder="Name"
              />
              <input
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className="flex-1 px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#F97316]"
                placeholder="Email (optional)"
              />
              <button
                type="submit"
                className="text-xs bg-[#1F2D3D] hover:bg-[#2C3E50] text-white px-3 py-1.5 rounded transition-colors cursor-pointer"
              >
                Add
              </button>
            </form>
          </div>

          {/* Next Steps */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Next Steps
            </label>
            {event.next_steps?.length > 0 && (
              <div className="space-y-1 mb-2">
                {event.next_steps.map((step, i) => (
                  <label
                    key={step.id || i}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={step.done || false}
                      onChange={(e) =>
                        onToggleStep(step.id, e.target.checked)
                      }
                      className="rounded border-gray-300 text-[#F97316] focus:ring-[#F97316] cursor-pointer"
                    />
                    <span className={step.done ? 'line-through text-gray-400' : 'text-gray-700'}>
                      {step.text}
                    </span>
                  </label>
                ))}
              </div>
            )}
            <form onSubmit={handleAddStep} className="flex items-center gap-2">
              <input
                value={stepText}
                onChange={(e) => setStepText(e.target.value)}
                className="flex-1 px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#F97316]"
                placeholder="Add a step..."
              />
              <button
                type="submit"
                className="text-xs bg-[#1F2D3D] hover:bg-[#2C3E50] text-white px-3 py-1.5 rounded transition-colors cursor-pointer"
              >
                Add
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function AddEventModal({ onClose, onSave, saving }) {
  const [form, setForm] = useState({
    title: '',
    date: '',
    type: 'networking',
    location: '',
    notes: '',
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    onSave({
      ...form,
      date: form.date ? new Date(form.date).toISOString() : new Date().toISOString(),
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-[#1F2D3D]">Log Event</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl cursor-pointer">
            &times;
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
            <input
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316]"
              placeholder="Coffee chat with Jane"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date & Time</label>
              <input
                type="datetime-local"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316]"
              >
                {Object.entries(EVENT_TYPES).map(([key, { label }]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
            <input
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316]"
              placeholder="Zoom / Blue Bottle Coffee / etc."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] resize-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="bg-[#F97316] hover:bg-[#EA580C] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'Saving...' : 'Save Event'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
