import React, { useState, useEffect } from 'react';
import { Mic2, AlertCircle, Sparkles, FileText, AlertTriangle, Clock, X, Trash2 } from 'lucide-react';
import AudioPlayer from './components/AudioPlayer';
import { generateSpeech } from './services/gemini';
import { base64ToUint8Array, pcmToWav, formatTime, concatenateBuffers } from './utils/audio';
import { HistoryItem } from './types';

const MAX_CHARS = 10000; 

const App: React.FC = () => {
  const [text, setText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [processingTime, setProcessingTime] = useState(0);
  
  // Audio State
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  
  // History State
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // Cleanup object URLs
  useEffect(() => {
    return () => {
      if (audioUrl) window.URL.revokeObjectURL(audioUrl);
      history.forEach(item => {
        window.URL.revokeObjectURL(item.audioUrl);
      });
    };
  }, [audioUrl, history]);

  // Processing Timer Effect
  useEffect(() => {
    let interval: number;
    if (isLoading) {
      setProcessingTime(0);
      interval = window.setInterval(() => {
        setProcessingTime(prev => prev + 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isLoading]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    if (newText.length <= MAX_CHARS) {
      setText(newText);
    }
  };

  const clearTextInput = () => {
    setText('');
    setError(null);
    if (audioUrl) {
      window.URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
      setAudioBlob(null);
    }
  };

  const handleGenerate = async () => {
    if (!text.trim()) return;

    // Reset States
    setIsLoading(true);
    setError(null);
    setProgress(null);
    
    if (audioUrl) {
      window.URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
      setAudioBlob(null);
    }

    try {
      // 1. Prepare Text Chunks
      // Split by paragraphs first, then merge small paragraphs to avoid excessive small requests
      const rawParagraphs = text.split(/\n+/);
      const chunks: string[] = [];
      let currentChunk = "";
      const CHUNK_SOFT_LIMIT = 800; // Characters

      for (const p of rawParagraphs) {
        const trimmed = p.trim();
        if (!trimmed) continue;
        
        // If adding this paragraph keeps us under limit (or if current chunk is empty), add it
        if (currentChunk.length + trimmed.length < CHUNK_SOFT_LIMIT || currentChunk.length === 0) {
          currentChunk += (currentChunk ? "\n\n" : "") + trimmed;
        } else {
          // Push current chunk and start new one
          chunks.push(currentChunk);
          currentChunk = trimmed;
        }
      }
      if (currentChunk) chunks.push(currentChunk);

      if (chunks.length === 0) throw new Error("No text to process.");

      // 2. Sequential Audio Generation
      const pcmParts: Uint8Array[] = [];
      setProgress({ current: 0, total: chunks.length });

      for (let i = 0; i < chunks.length; i++) {
        // Update progress UI
        setProgress({ current: i + 1, total: chunks.length });
        
        // Generate audio for this chunk
        const base64Audio = await generateSpeech(chunks[i]);
        const pcmData = base64ToUint8Array(base64Audio);
        pcmParts.push(pcmData);
      }

      // 3. Merge and Create WAV
      const fullPcm = concatenateBuffers(pcmParts);
      const wavBlob = pcmToWav(fullPcm);
      const url = window.URL.createObjectURL(wavBlob);

      setAudioBlob(wavBlob);
      setAudioUrl(url);

      // 4. Add to History
      const newHistoryItem: HistoryItem = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        textSnippet: text.substring(0, 60) + (text.length > 60 ? '...' : ''),
        audioUrl: url,
        audioBlob: wavBlob,
      };
      setHistory(prev => [newHistoryItem, ...prev]);

    } catch (err: any) {
      console.error(err);
      const msg = err.message || "Unable to generate audio.";
      setError(msg.includes("Rpc") ? "Connection failed. Please try again." : msg);
    } finally {
      setIsLoading(false);
      setProgress(null);
      setProcessingTime(0);
    }
  };

  const restoreFromHistory = (item: HistoryItem) => {
    // Revoke previous audio URL if any before setting new one
    if (audioUrl) {
      window.URL.revokeObjectURL(audioUrl);
    }
    setText(item.textSnippet); // Optionally load full text if stored, for now just snippet
    setAudioUrl(item.audioUrl);
    setAudioBlob(item.audioBlob);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const deleteHistoryItem = (id: string) => {
    setHistory(prev => {
      const itemToDelete = prev.find(item => item.id === id);
      if (itemToDelete) {
        window.URL.revokeObjectURL(itemToDelete.audioUrl); // Revoke URL when deleting
      }
      return prev.filter(item => item.id !== id);
    });
    // If the currently playing audio is deleted, reset player
    if (audioUrl && history.find(item => item.id === id && item.audioUrl === audioUrl)) {
      setAudioUrl(null);
      setAudioBlob(null);
    }
  };

  const handleAutoPlayError = () => console.debug("Auto-play blocked");
  const isOverLimit = text.length >= MAX_CHARS;

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col items-center p-4 sm:p-8 font-inter">
      
      <div className="w-full max-w-4xl flex flex-col gap-8 mt-6 sm:mt-12 mb-12">
        
        {/* Header */}
        <div className="text-center space-y-4">
            <div className="inline-flex items-center justify-center p-4 bg-gray-800 rounded-full ring-1 ring-gray-700 shadow-lg shadow-black/50">
               <Mic2 size={32} className="text-blue-500" />
            </div>
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">Pro Script Reader</h1>
              <p className="text-gray-400 mt-2 font-medium">
                Professional text-to-speech
              </p>
            </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Main Interface (Left Col) */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-gray-800 rounded-2xl border border-gray-700 shadow-xl overflow-hidden">
                <div className="p-6">
                  <label className="block text-sm font-medium text-gray-400 mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileText size={16} />
                      <span>Script Input</span>
                    </div>
                    {text.length > MAX_CHARS * 0.9 && (
                       <span className="text-orange-400 text-xs flex items-center gap-1">
                         <AlertTriangle size={12} />
                         Near limit
                       </span>
                    )}
                  </label>
                  
                  <div className="relative">
                    <textarea
                        value={text}
                        onChange={handleTextChange}
                        placeholder="Paste your story here..."
                        className={`
                          w-full h-48 bg-gray-900/50 border text-gray-100 p-4 rounded-xl pr-12 placeholder-gray-600 resize-none 
                          focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all text-lg leading-relaxed
                          ${isOverLimit ? 'border-red-500/50 focus:border-red-500' : 'border-gray-700 focus:border-blue-500'}
                        `}
                        spellCheck="false"
                    />
                    {text.length > 0 && (
                      <button
                        onClick={clearTextInput}
                        className="absolute top-3 right-3 text-gray-500 hover:text-white p-1 rounded-full hover:bg-gray-700 transition-colors"
                        title="Clear Input"
                      >
                        <X size={16} />
                      </button>
                    )}
                    <div className={`
                        absolute bottom-3 right-3 text-xs font-mono px-2 py-1 rounded transition-colors
                        ${isOverLimit ? 'bg-red-500/20 text-red-300' : 'bg-gray-900/80 text-gray-500'}
                    `}>
                        {text.length} / {MAX_CHARS}
                    </div>
                  </div>

                  {error && (
                      <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-3 text-red-400 text-sm animate-fade-in">
                          <AlertCircle size={18} className="shrink-0" />
                          <span>{error}</span>
                      </div>
                  )}

                  <div className="mt-6 flex justify-end">
                      <button
                          onClick={handleGenerate}
                          disabled={isLoading || !text.trim()}
                          className={`
                              relative overflow-hidden group
                              flex items-center gap-2 px-6 py-3 rounded-lg font-semibold text-white shadow-lg transition-all
                              ${isLoading || !text.trim() 
                                  ? 'bg-gray-700 cursor-not-allowed opacity-50' 
                                  : 'bg-blue-600 hover:bg-blue-500 hover:shadow-blue-500/25 active:scale-95'
                              }
                          `}
                          style={{ minWidth: '180px' }}
                      >
                          {isLoading ? (
                              <div className="flex flex-col items-center justify-center w-full py-1">
                                  {progress ? (
                                      <div className="w-full space-y-1">
                                          <div className="flex justify-between text-xs text-blue-100 font-mono w-full px-1">
                                              <span>Generating Part {progress.current}/{progress.total}</span>
                                              <span>{formatTime(processingTime)}</span>
                                          </div>
                                          <div className="w-full h-1.5 bg-black/20 rounded-full overflow-hidden">
                                              <div 
                                                className="h-full bg-white/90 rounded-full transition-all duration-300 ease-out"
                                                style={{ width: `${(progress.current / progress.total) * 100}%` }}
                                              />
                                          </div>
                                      </div>
                                  ) : (
                                      <div className="flex items-center gap-2">
                                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        <span className="font-mono">Processing...</span>
                                      </div>
                                  )}
                              </div>
                          ) : (
                              <div className="flex items-center gap-2">
                                  <Sparkles size={18} />
                                  <span>Generate Voice</span>
                              </div>
                          )}
                      </button>
                  </div>
                </div>
            </div>

            {/* Audio Output */}
            {audioUrl && (
               <div className="animate-fade-in-up space-y-6">
                 <AudioPlayer 
                    audioUrl={audioUrl} 
                    blob={audioBlob} 
                    onAutoPlayError={handleAutoPlayError}
                 />
               </div>
            )}
          </div>

          {/* History Sidebar (Right Col) */}
          <div className="lg:col-span-1">
            <div className="bg-gray-800 rounded-2xl border border-gray-700 shadow-xl overflow-hidden h-full max-h-[600px] flex flex-col">
               <div className="p-4 border-b border-gray-700 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-gray-300 font-medium">
                    <Clock size={18} />
                    <span>History</span>
                  </div>
                  <span className="text-xs text-gray-500 bg-gray-900 px-2 py-1 rounded-full">{history.length}</span>
               </div>
               
               <div className="overflow-y-auto p-4 space-y-3 flex-1 custom-scrollbar">
                  {history.length === 0 ? (
                    <div className="text-center text-gray-500 py-8 text-sm">
                      <p>No stories yet.</p>
                      <p className="mt-1">Generate something to see history.</p>
                    </div>
                  ) : (
                    history.map(item => (
                      <div 
                        key={item.id} 
                        className="bg-gray-900/50 border border-gray-700/50 rounded-lg p-3 group relative pr-10"
                      >
                         <button
                           onClick={(e) => {
                             e.stopPropagation(); // Prevent triggering restoreFromHistory
                             deleteHistoryItem(item.id);
                           }}
                           className="absolute top-2 right-2 text-gray-500 hover:text-red-400 p-1 rounded-full hover:bg-gray-700 transition-colors"
                           title="Delete from history"
                         >
                           <Trash2 size={16} />
                         </button>
                         <div 
                            onClick={() => restoreFromHistory(item)}
                            className="cursor-pointer transition-all flex items-start gap-3"
                         >
                            <div className={`w-12 h-12 rounded-lg bg-gray-800 shrink-0 overflow-hidden border border-gray-700 flex items-center justify-center text-gray-600`}>
                               <Mic2 size={16} />
                            </div>
                            <div className="min-w-0 flex-1">
                               <p className="text-sm text-gray-300 line-clamp-2 leading-relaxed">{item.textSnippet}</p>
                               <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                                  <span>{new Date(item.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                               </div>
                            </div>
                         </div>
                      </div>
                    ))
                  )}
               </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default App;