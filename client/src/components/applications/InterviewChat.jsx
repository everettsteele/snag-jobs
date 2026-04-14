import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';

const SUGGESTIONS_BY_MODE = {
  coach: [
    'Generate 10 likely questions for this role',
    'Help me rehearse behavioral answers from my resume',
  ],
  practice: [
    'Start with a behavioral question',
    'Hit me with a tough case from the job description',
    "Focus on this role's hardest skill",
  ],
};

export default function InterviewChat({ app }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState('coach');
  const listRef = useRef(null);

  const { data: contacts = [] } = useQuery({
    queryKey: ['app-contacts', app.id],
    queryFn: () => api.get(`/applications/${app.id}/contacts`),
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['app-chat', app.id, mode],
    queryFn: () => api.get(`/applications/${app.id}/chat?mode=${mode}`),
    enabled: !!user?.isPro,
  });

  const sendMut = useMutation({
    mutationFn: (message) => api.post(`/applications/${app.id}/chat`, { message, mode }),
    onSuccess: () => setDraft(''),
    onSettled: () => { qc.invalidateQueries({ queryKey: ['app-chat', app.id, mode] }); },
  });

  const clearMut = useMutation({
    mutationFn: () => api.del(`/applications/${app.id}/chat`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['app-chat', app.id, 'coach'] });
      qc.invalidateQueries({ queryKey: ['app-chat', app.id, 'practice'] });
    },
  });

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [data?.messages?.length, sendMut.isPending]);

  if (!user?.isPro) {
    return (
      <div className="text-center py-8">
        <div className="text-sm font-semibold text-[#1F2D3D] mb-1">Interview Prep Chat is Pro-only</div>
        <p className="text-xs text-gray-500 mb-3">
          Unlock a Claude-powered coach for this interview with full context on the role, your resume, and the people you're meeting.
        </p>
        <a href="/settings#billing" className="inline-block text-xs bg-[#F97316] hover:bg-[#EA580C] text-white px-4 py-2 rounded-lg">
          Upgrade to Pro
        </a>
      </div>
    );
  }

  if (error) {
    return <div className="text-xs text-red-600">{error.message}</div>;
  }

  const messages = data?.messages || [];
  const turnCount = data?.turn_count || 0;
  const cap = data?.cap || 80;
  const capped = turnCount >= cap;

  const firstInterviewer = contacts.find((c) => c.kind === 'interviewer');
  const baseSuggestions = SUGGESTIONS_BY_MODE[mode] || SUGGESTIONS_BY_MODE.coach;
  const suggestions = [
    ...baseSuggestions,
    ...(mode === 'coach' && firstInterviewer
        ? [`Research ${firstInterviewer.name} and suggest what to ask them`]
        : []),
  ];

  const onSend = (text) => {
    const msg = (text ?? draft).trim();
    if (!msg || sendMut.isPending) return;
    sendMut.mutate(msg);
  };

  return (
    <div className="flex flex-col h-[420px]">
      <div className="flex items-center justify-between mb-2">
        <div className="inline-flex bg-gray-100 rounded-md p-0.5">
          <button
            type="button"
            onClick={() => setMode('coach')}
            className={`text-xs px-3 py-1 rounded cursor-pointer ${mode === 'coach' ? 'bg-white text-[#1F2D3D] shadow-sm' : 'text-gray-500'}`}
          >
            Coach
          </button>
          <button
            type="button"
            onClick={() => setMode('practice')}
            className={`text-xs px-3 py-1 rounded cursor-pointer ${mode === 'practice' ? 'bg-white text-[#1F2D3D] shadow-sm' : 'text-gray-500'}`}
          >
            Practice
          </button>
        </div>
        <div className="text-[10px] text-gray-500">
          {mode === 'practice' ? 'Claude plays the interviewer.' : 'Claude coaches your prep.'}
        </div>
      </div>
      <div ref={listRef} className="flex-1 overflow-y-auto space-y-3 pr-1">
        {isLoading ? (
          <div className="text-xs text-gray-400 py-8 text-center">Loading history...</div>
        ) : messages.length === 0 ? (
          <div className="py-6">
            <p className="text-xs text-gray-500 mb-3">Ask anything. Claude has your resume, the JD, the people on this app, and your notes.</p>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => onSend(s)}
                  className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-2.5 py-1 rounded-full cursor-pointer"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-[#F97316] text-white'
                  : 'bg-gray-100 text-gray-800'
              }`}>
                {m.content}
              </div>
            </div>
          ))
        )}
        {sendMut.isPending && (
          <div className="flex justify-start">
            <div className="bg-gray-100 text-gray-500 rounded-lg px-3 py-2 text-sm">...</div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-[10px] text-gray-500 mt-2 mb-1">
        <span>{turnCount}/{cap} turns</span>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button onClick={() => navigator.clipboard.writeText(messages[messages.length - 1]?.content || '')}
                    className="hover:text-[#F97316] cursor-pointer">Copy last reply</button>
          )}
          {messages.length > 0 && (
            <button onClick={() => { if (window.confirm('Clear chat history?')) clearMut.mutate(); }}
                    className="hover:text-red-600 cursor-pointer">Clear chat</button>
          )}
        </div>
      </div>

      <div className="flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSend(); }
          }}
          disabled={capped || sendMut.isPending}
          placeholder={capped ? 'Chat full — clear to continue' : 'Ask a question (⌘/Ctrl+Enter)'}
          rows={2}
          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#F97316] disabled:bg-gray-50 disabled:text-gray-400"
        />
        <button
          onClick={() => onSend()}
          disabled={!draft.trim() || capped || sendMut.isPending}
          className="text-sm bg-[#F97316] hover:bg-[#EA580C] text-white px-4 py-2 rounded-lg cursor-pointer disabled:opacity-50"
        >
          {sendMut.isPending ? '...' : 'Send'}
        </button>
      </div>
      {sendMut.error && (
        <div className="text-[11px] text-red-600 mt-1">{sendMut.error.message}</div>
      )}
    </div>
  );
}
