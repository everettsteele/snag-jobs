import { useState } from 'react';

export default function DebriefLogModal({ onClose, onSave, saving }) {
  const [transcript, setTranscript] = useState('');
  const tooShort = transcript.trim().length < 500;

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[110] flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col">
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-[#1F2D3D]">Log Interview Debrief</h2>
            <p className="text-xs text-gray-500 mt-0.5">Paste a transcript or type notes about how the interview went. We'll summarize + draft a thank-you.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none cursor-pointer">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Paste the interview transcript here, or describe what happened, who said what, what questions came up..."
            rows={14}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#F97316] font-mono"
          />
          <div className="text-[11px] text-gray-400 mt-1 flex items-center justify-between">
            <span>{transcript.trim().length} chars</span>
            <span>{tooShort ? 'Needs at least 500 characters.' : 'Looks good.'}</span>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-3 border-t border-gray-100">
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 cursor-pointer">Cancel</button>
          <button
            onClick={() => !tooShort && onSave(transcript.trim())}
            disabled={tooShort || saving}
            className="text-sm bg-[#F97316] hover:bg-[#EA580C] text-white px-4 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
          >
            {saving ? 'Generating...' : 'Generate Debrief'}
          </button>
        </div>
      </div>
    </div>
  );
}
