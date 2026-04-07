
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { transcribeAudio, translateText } from './services/geminiService';
import { UploadIcon, FileIcon, CopyIcon, CheckIcon, TrashIcon, LoadingSpinner, LanguageIcon, ChevronDownIcon, LinkIcon, DownloadIcon } from './components/icons';

const App: React.FC = () => {
    const [file, setFile] = useState<File | null>(null);
    const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
    const [language, setLanguage] = useState<string>('English');
    const [transcription, setTranscription] = useState<string>('');
    const [subtitles, setSubtitles] = useState<string>('');
    const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string>('');
    const [isCopied, setIsCopied] = useState<boolean>(false);
    const [isDragging, setIsDragging] = useState<boolean>(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [inputMode, setInputMode] = useState<'upload' | 'url'>('upload');
    const [url, setUrl] = useState<string>('');
    const [isUrlLoading, setIsUrlLoading] = useState<boolean>(false);
    const [identifySpeakers, setIdentifySpeakers] = useState<boolean>(false);
    const [generateSubtitles, setGenerateSubtitles] = useState<boolean>(false);

    // New states for translation
    const [targetLanguage, setTargetLanguage] = useState<string>('Hindi');
    const [translatedText, setTranslatedText] = useState<string>('');
    const [isTranslating, setIsTranslating] = useState<boolean>(false);
    const [translationError, setTranslationError] = useState<string>('');
    const [isTranslatedTextCopied, setIsTranslatedTextCopied] = useState<boolean>(false);
    const [translateAsSubtitles, setTranslateAsSubtitles] = useState<boolean>(false);
    const [translatedSubtitleUrl, setTranslatedSubtitleUrl] = useState<string | null>(null);

    const vttToPlainText = (vttString: string): string => {
        if (!vttString.trim().startsWith('WEBVTT')) {
            return vttString;
        }
        return vttString
            .split('\n')
            .filter(line => 
                !line.trim().startsWith('WEBVTT') &&
                !line.match(/^\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/) &&
                !line.match(/^\d+$/) &&
                line.trim() !== ''
            )
            .map(line => line.replace(/<[^>]+>/g, '').trim())
            .join('\n');
    };

    const vttToSrt = (vttContent: string): string => {
        // Return empty string for invalid input to trigger error in UI
        if (!vttContent || !vttContent.trim().startsWith('WEBVTT')) {
            return '';
        }

        // Normalize line endings and remove header/metadata
        const cleanVtt = vttContent
            .replace(/\r\n/g, '\n') // Normalize line endings
            .split('\n')
            .filter(line => 
                !line.trim().startsWith('WEBVTT') && 
                !line.trim().startsWith('NOTE') && 
                !line.trim().startsWith('STYLE')
            )
            .join('\n')
            .trim();

        // Split into cues based on one or more blank lines
        const cues = cleanVtt.split(/\n\n+/);
        let srtContent = '';
        let cueNumber = 1;

        for (const cue of cues) {
            if (!cue.trim()) continue;

            const lines = cue.split('\n');
            let timestampLine = '';
            const textLines: string[] = [];
            let timestampFound = false;

            for (const line of lines) {
                if (line.includes('-->')) {
                    timestampLine = line;
                    timestampFound = true;
                } else if (timestampFound) {
                    // Collect all subsequent lines as text
                    textLines.push(line);
                }
                // Lines before timestamp (like cue identifiers) are correctly ignored.
            }

            if (timestampLine) {
                srtContent += `${cueNumber}\n`;
                // SRT uses comma for milliseconds
                srtContent += `${timestampLine.replace(/\./g, ',')}\n`;
                // Join text and remove VTT-specific tags
                srtContent += `${textLines.join('\n').replace(/<[^>]+>/g, '').trim()}\n\n`;
                cueNumber++;
            }
        }

        return srtContent.trim(); // Return trimmed final string
    };


    useEffect(() => {
        return () => {
            if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
            if (subtitleUrl) URL.revokeObjectURL(subtitleUrl);
            if (translatedSubtitleUrl) URL.revokeObjectURL(translatedSubtitleUrl);
        };
    }, [filePreviewUrl, subtitleUrl, translatedSubtitleUrl]);

    useEffect(() => {
        if (subtitles) {
            const blob = new Blob([subtitles], { type: 'text/vtt' });
            setSubtitleUrl(URL.createObjectURL(blob));
        } else {
            setSubtitleUrl(null);
        }
    }, [subtitles]);
    
    useEffect(() => {
        if (translatedText && translateAsSubtitles) {
            const blob = new Blob([translatedText], { type: 'text/vtt' });
            setTranslatedSubtitleUrl(URL.createObjectURL(blob));
        } else {
            setTranslatedSubtitleUrl(null);
        }
    }, [translatedText, translateAsSubtitles]);

    const handleFileSelect = (selectedFile: File | undefined) => {
        if (selectedFile) {
            if (filePreviewUrl) {
                URL.revokeObjectURL(filePreviewUrl);
            }
            setFile(selectedFile);
            setFilePreviewUrl(URL.createObjectURL(selectedFile));
            setTranscription('');
            setSubtitles('');
            setError('');
            setTranslatedText('');
            setTranslationError('');
            setTranslateAsSubtitles(false);
        }
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        handleFileSelect(event.target.files?.[0]);
    };

    const handleRemoveFile = () => {
        if (filePreviewUrl) {
            URL.revokeObjectURL(filePreviewUrl);
            setFilePreviewUrl(null);
        }
        setFile(null);
        setUrl('');
        setTranscription('');
        setSubtitles('');
        setError('');
        setTranslatedText('');
        setTranslationError('');
        setTranslateAsSubtitles(false);
        setInputMode('upload');
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDragging(false);
        handleFileSelect(event.dataTransfer.files?.[0]);
    };

    const handleLoadUrl = async () => {
        if (!url.trim() || !url.startsWith('http')) {
            setError('Please enter a valid URL.');
            return;
        }
        setIsUrlLoading(true);
        setError('');

        try {
            // Using a CORS proxy for fetching URL content to avoid CORS issues.
            // This is a simple proxy, for production a more robust solution should be used.
            const proxyUrl = 'https://cors-anywhere.herokuapp.com/';
            const response = await fetch(proxyUrl + url);
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            const blob = await response.blob();
            if (!blob.type.startsWith('audio/') && !blob.type.startsWith('video/')) {
                throw new Error(`URL does not point to a valid media file. Type found: ${blob.type || 'unknown'}`);
            }
            const fileName = new URL(url).pathname.split('/').pop() || 'media_from_url';
            const loadedFile = new File([blob], fileName, { type: blob.type });
            handleFileSelect(loadedFile);
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : 'An unexpected error occurred';
            setError(`Failed to load from URL. ${errorMessage}. This can happen due to network issues or server CORS policies. Please ensure the URL is a direct, public link to a media file.`);
        } finally {
            setIsUrlLoading(false);
        }
    };

    const handleTranscribe = useCallback(async () => {
        if (!file) {
            setError('Please provide a file first.');
            return;
        }
        if (!language.trim()) {
            setError('Please specify the language of the audio.');
            return;
        }

        setIsLoading(true);
        setError('');
        setTranscription('');
        setSubtitles('');
        setTranslatedText('');
        setTranslationError('');
        setTranslateAsSubtitles(false);

        try {
            const { transcription: result, subtitles: vttResult } = await transcribeAudio(file, language, identifySpeakers, generateSubtitles);
            if (result.startsWith('Error:')) {
                setError(result);
                setTranscription('');
                setSubtitles('');
            } else {
                setTranscription(result);
                setSubtitles(vttResult);
                setError('');
            }
        } catch (e: unknown) {
            const errorMessage = e instanceof Error ? e.message : 'An unexpected error occurred.';
            setError(errorMessage);
            setTranscription('');
            setSubtitles('');
        } finally {
            setIsLoading(false);
        }
    }, [file, language, identifySpeakers, generateSubtitles]);
    
    const handleTranslate = useCallback(async () => {
        const contentToTranslate = translateAsSubtitles && subtitles ? subtitles : transcription;
        
        if (!contentToTranslate) {
            setTranslationError('There is no text to translate.');
            return;
        }
        
        setIsTranslating(true);
        setTranslatedText('');
        setTranslationError('');

        try {
            const result = await translateText(contentToTranslate, targetLanguage, translateAsSubtitles);
             if (result.startsWith('Error:')) {
                setTranslationError(result);
                setTranslatedText('');
            } else {
                setTranslatedText(result);
                setTranslationError('');
            }
        } catch (e: unknown) {
            const errorMessage = e instanceof Error ? e.message : 'An unexpected error occurred.';
            setTranslationError(errorMessage);
            setTranslatedText('');
        } finally {
            setIsTranslating(false);
        }
    }, [transcription, subtitles, targetLanguage, translateAsSubtitles]);

    const handleCopy = () => {
        if (transcription) {
            navigator.clipboard.writeText(transcription);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2500);
        }
    };

    const handleCopyTranslatedText = () => {
        if (translatedText) {
            const textToCopy = translateAsSubtitles ? vttToPlainText(translatedText) : translatedText;
            navigator.clipboard.writeText(textToCopy);
            setIsTranslatedTextCopied(true);
            setTimeout(() => setIsTranslatedTextCopied(false), 2500);
        }
    };

    const handleDownloadVtt = (url: string | null, langCode: string) => {
        if (!url || !file) return;
        const a = document.createElement('a');
        a.href = url;
        const fileName = file.name.split('.').slice(0, -1).join('.') || file.name;
        a.download = `${fileName}.${langCode}.vtt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    const handleDownloadSrt = (vttContent: string, langCode: string) => {
        if (!vttContent || !file) return;
        const srtContent = vttToSrt(vttContent);
        if (!srtContent) {
            setError("Failed to convert subtitles to SRT format.");
            return;
        }
        const blob = new Blob([srtContent], { type: 'application/x-subrip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const fileName = file.name.split('.').slice(0, -1).join('.') || file.name;
        a.download = `${fileName}.${langCode}.srt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col items-center p-4 sm:p-6 lg:p-8">
            <div className="w-full max-w-6xl mx-auto">
                <header className="text-center mb-8">
                    <h1 className="text-4xl sm:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-indigo-600">
                        AI Audio & Video Transcriber
                    </h1>
                    <p className="mt-2 text-lg text-gray-400">Powered by Gemini</p>
                </header>

                <main className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Left Column: Input */}
                    <div className="bg-gray-800/50 rounded-2xl p-6 shadow-2xl border border-gray-700 backdrop-blur-sm">
                        <h2 className="text-2xl font-bold mb-4 text-sky-300">1. Provide Your File</h2>
                        {!file ? (
                            <>
                                <div className="flex mb-4 border-b border-gray-700">
                                    <button
                                        onClick={() => setInputMode('upload')}
                                        className={`px-4 py-2 font-semibold transition-colors ${inputMode === 'upload' ? 'text-sky-400 border-b-2 border-sky-400' : 'text-gray-400 hover:text-white'}`}
                                    >
                                        Upload File
                                    </button>
                                    <button
                                        onClick={() => setInputMode('url')}
                                        className={`px-4 py-2 font-semibold transition-colors ${inputMode === 'url' ? 'text-sky-400 border-b-2 border-sky-400' : 'text-gray-400 hover:text-white'}`}
                                    >
                                        From URL
                                    </button>
                                </div>
                                {inputMode === 'upload' ? (
                                    <div
                                        onDragOver={handleDragOver}
                                        onDragLeave={handleDragLeave}
                                        onDrop={handleDrop}
                                        onClick={() => fileInputRef.current?.click()}
                                        className={`flex flex-col items-center justify-center p-10 border-2 border-dashed rounded-lg cursor-pointer transition-all duration-300 ${isDragging ? 'border-sky-400 bg-gray-700/50' : 'border-gray-600 hover:border-sky-500 hover:bg-gray-700/30'}`}
                                    >
                                        <input
                                            type="file"
                                            ref={fileInputRef}
                                            onChange={handleFileChange}
                                            className="hidden"
                                            accept="audio/*,video/mp4,video/quicktime,video/webm,video/x-msvideo,video/mpeg,.mp3,.wav,.m4a,.mp4,.mov,.mpeg,.webm,.avi"
                                            id="file-upload"
                                        />
                                        <UploadIcon className="w-12 h-12 text-gray-500 mb-3" />
                                        <p className="text-gray-400">
                                            <span className="font-semibold text-sky-400">Click to upload</span> or drag and drop
                                        </p>
                                        <p className="text-xs text-gray-500 mt-1">Audio or Video files</p>
                                    </div>
                                ) : (
                                    <div>
                                        <div className="relative">
                                            <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
                                            <input
                                                type="text"
                                                value={url}
                                                onChange={(e) => setUrl(e.target.value)}
                                                placeholder="https://example.com/audio.mp3"
                                                className="w-full bg-gray-700/50 border border-gray-600 rounded-lg py-3 pl-10 pr-4 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none transition-colors"
                                            />
                                        </div>
                                        <p className="text-xs text-gray-500 mt-2 px-1">
                                            Enter a direct public URL to an audio or video file. Links from platforms like YouTube or Facebook are not supported.
                                        </p>
                                        <button
                                            onClick={handleLoadUrl}
                                            disabled={isUrlLoading}
                                            className="w-full mt-4 flex items-center justify-center gap-2 bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-300"
                                        >
                                            {isUrlLoading ? <LoadingSpinner /> : null}
                                            {isUrlLoading ? 'Loading...' : 'Load from URL'}
                                        </button>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="bg-gray-700/50 p-4 rounded-lg flex flex-col gap-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3 overflow-hidden">
                                        <FileIcon className="w-8 h-8 text-sky-400 flex-shrink-0" />
                                        <div className="truncate">
                                            <p className="font-medium text-white truncate">{file.name}</p>
                                            <p className="text-xs text-gray-400">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                                        </div>
                                    </div>
                                    <button onClick={handleRemoveFile} className="p-2 rounded-full hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors flex-shrink-0 ml-2">
                                        <TrashIcon className="w-5 h-5" />
                                    </button>
                                </div>
                                {filePreviewUrl && (
                                    <div className="mt-2">
                                        {file.type.startsWith('audio/') ? (
                                            <audio controls src={filePreviewUrl} className="w-full">
                                                Your browser does not support the audio element.
                                            </audio>
                                        ) : (
                                            <video controls src={filePreviewUrl} className="w-full rounded-lg max-h-48 bg-black">
                                                Your browser does not support the video tag.
                                            </video>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        <h2 className="text-2xl font-bold mt-8 mb-4 text-sky-300">2. Specify Options</h2>
                        <div className="relative mb-4">
                             <LanguageIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
                            <select
                                value={language}
                                onChange={(e) => setLanguage(e.target.value)}
                                className="w-full bg-gray-700/50 border border-gray-600 rounded-lg py-3 pl-10 pr-10 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none transition-colors appearance-none"
                                aria-label="Select language"
                            >
                                <option>English</option>
                                <option>Hindi</option>
                                <option>Tamil</option>
                                <option>Sanskrit</option>
                                <option>Telugu</option>
                            </select>
                            <ChevronDownIcon className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
                        </div>
                        
                        <div className="space-y-3">
                            <div className="flex items-center">
                                <input
                                    type="checkbox"
                                    id="identifySpeakers"
                                    checked={identifySpeakers}
                                    onChange={(e) => setIdentifySpeakers(e.target.checked)}
                                    className="h-4 w-4 rounded border-gray-500 bg-gray-700 text-sky-500 focus:ring-sky-500"
                                    aria-describedby="identifySpeakers-description"
                                />
                                <label htmlFor="identifySpeakers" className="ml-3 block text-sm font-medium text-gray-300">
                                    Identify multiple speakers
                                </label>
                            </div>
                             <div className="flex items-center">
                                <input
                                    type="checkbox"
                                    id="generateSubtitles"
                                    checked={generateSubtitles}
                                    onChange={(e) => setGenerateSubtitles(e.target.checked)}
                                    className="h-4 w-4 rounded border-gray-500 bg-gray-700 text-sky-500 focus:ring-sky-500"
                                />
                                <label htmlFor="generateSubtitles" className="ml-3 block text-sm font-medium text-gray-300">
                                    Generate subtitles (.vtt)
                                </label>
                            </div>
                        </div>

                        <div className="mt-8">
                            <button
                                onClick={handleTranscribe}
                                disabled={!file || isLoading}
                                className={`w-full flex items-center justify-center gap-2 bg-gradient-to-r from-sky-500 to-indigo-600 text-white font-bold py-3 px-4 rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity duration-300 shadow-lg ${file && !isLoading ? 'animate-pulse-glow' : ''}`}
                            >
                                {isLoading ? <LoadingSpinner /> : null}
                                {isLoading ? 'Transcribing...' : 'Transcribe'}
                            </button>
                        </div>
                    </div>

                    {/* Right Column: Output */}
                    <div className="bg-gray-800/50 rounded-2xl p-6 shadow-2xl border border-gray-700 backdrop-blur-sm flex flex-col">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-2xl font-bold text-sky-300">3. Get Your Transcription</h2>
                            <div className="flex items-center gap-2">
                                {subtitles && (
                                     <>
                                        <button onClick={() => handleDownloadVtt(subtitleUrl, language.slice(0, 2).toLowerCase())} className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-gray-300 py-1 px-3 rounded-lg text-sm transition-colors" title="Download VTT file">
                                            <DownloadIcon className="w-4 h-4" />
                                            VTT
                                        </button>
                                        <button onClick={() => handleDownloadSrt(subtitles, language.slice(0, 2).toLowerCase())} className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-gray-300 py-1 px-3 rounded-lg text-sm transition-colors" title="Download SRT file">
                                            <DownloadIcon className="w-4 h-4" />
                                            SRT
                                        </button>
                                     </>
                                )}
                                {transcription && (
                                    <button onClick={handleCopy} className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-gray-300 py-1 px-3 rounded-lg text-sm transition-colors">
                                        {isCopied ? <CheckIcon className="w-4 h-4 text-green-400" /> : <CopyIcon className="w-4 h-4" />}
                                        {isCopied ? 'Copied!' : 'Copy'}
                                    </button>
                                )}
                            </div>
                        </div>
                        
                        {file?.type.startsWith('video/') && subtitleUrl && filePreviewUrl && (
                            <div className="mb-4 rounded-lg overflow-hidden bg-black flex-shrink-0">
                                <video controls key={filePreviewUrl} className="w-full max-h-60" preload="metadata">
                                    <source src={filePreviewUrl} type={file.type} />
                                    <track label="English" kind="subtitles" srcLang="en" src={subtitleUrl} default />
                                    Your browser does not support the video tag.
                                </video>
                            </div>
                        )}

                        <div className="w-full flex-grow bg-gray-900/70 rounded-lg p-4 overflow-y-auto relative min-h-[200px]">
                             {isLoading && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900/50 backdrop-blur-sm z-10">
                                    <LoadingSpinner />
                                    <p className="mt-2 text-gray-300">Processing your file...</p>
                                </div>
                            )}
                            {error && (
                                <div className="text-red-400 flex items-center justify-center h-full text-center p-4">
                                    <p>{error}</p>
                                </div>
                            )}
                            {!isLoading && !error && !transcription && (
                                <div className="text-gray-500 flex items-center justify-center h-full">
                                    <p>Your transcription will appear here.</p>
                                </div>
                            )}
                            {transcription && (
                                <p className="text-gray-200 whitespace-pre-wrap font-mono text-sm">{transcription}</p>
                            )}
                        </div>
                        {transcription && !isLoading && (
                            <>
                                <div className="border-t border-gray-700 my-6"></div>
                                <div className="flex justify-between items-center mb-4">
                                    <h2 className="text-xl font-bold text-sky-300">4. Translate Transcription</h2>
                                    <div className="flex items-center gap-2">
                                        {translatedText && translateAsSubtitles && (
                                            <>
                                                <button onClick={() => handleDownloadVtt(translatedSubtitleUrl, targetLanguage.slice(0, 2).toLowerCase())} className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-gray-300 py-1 px-3 rounded-lg text-sm transition-colors" title="Download VTT file">
                                                    <DownloadIcon className="w-4 h-4" />
                                                    VTT
                                                </button>
                                                <button onClick={() => handleDownloadSrt(translatedText, targetLanguage.slice(0, 2).toLowerCase())} className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-gray-300 py-1 px-3 rounded-lg text-sm transition-colors" title="Download SRT file">
                                                    <DownloadIcon className="w-4 h-4" />
                                                    SRT
                                                </button>
                                            </>
                                        )}
                                        {translatedText && (
                                            <button onClick={handleCopyTranslatedText} className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-gray-300 py-1 px-3 rounded-lg text-sm transition-colors">
                                                {isTranslatedTextCopied ? <CheckIcon className="w-4 h-4 text-green-400" /> : <CopyIcon className="w-4 h-4" />}
                                                {isTranslatedTextCopied ? 'Copied!' : 'Copy'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {subtitles && (
                                    <div className="flex items-center mb-4">
                                        <input
                                            type="checkbox"
                                            id="translateAsSubtitles"
                                            checked={translateAsSubtitles}
                                            onChange={(e) => setTranslateAsSubtitles(e.target.checked)}
                                            className="h-4 w-4 rounded border-gray-500 bg-gray-700 text-sky-500 focus:ring-sky-500"
                                            aria-describedby="translateAsSubtitles-description"
                                        />
                                        <label htmlFor="translateAsSubtitles" className="ml-3 block text-sm font-medium text-gray-300">
                                            Translate as subtitles (.vtt)
                                        </label>
                                    </div>
                                )}
                                <div className="flex flex-col sm:flex-row gap-3 mb-4">
                                    <div className="relative flex-grow">
                                        <LanguageIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
                                        <select
                                            value={targetLanguage}
                                            onChange={(e) => setTargetLanguage(e.target.value)}
                                            className="w-full bg-gray-700/50 border border-gray-600 rounded-lg py-2.5 pl-10 pr-10 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none transition-colors appearance-none"
                                            aria-label="Select target language"
                                        >
                                            <option>English</option>
                                            <option>Hindi</option>
                                            <option>Tamil</option>
                                            <option>Sanskrit</option>
                                            <option>Telugu</option>
                                        </select>
                                        <ChevronDownIcon className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
                                    </div>
                                    <button
                                        onClick={handleTranslate}
                                        disabled={isTranslating}
                                        className="flex-shrink-0 flex items-center justify-center gap-2 bg-gray-600 hover:bg-gray-500 text-white font-bold py-2.5 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-300"
                                    >
                                        {isTranslating && <LoadingSpinner />}
                                        {isTranslating ? 'Translating...' : 'Translate'}
                                    </button>
                                </div>
                                <div className="w-full bg-gray-900/70 rounded-lg p-4 overflow-y-auto relative min-h-[150px]">
                                     {isTranslating && (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900/50 backdrop-blur-sm z-10">
                                            <LoadingSpinner />
                                            <p className="mt-2 text-gray-300">Translating text...</p>
                                        </div>
                                    )}
                                    {translationError && (
                                        <div className="text-red-400 flex items-center justify-center h-full text-center p-4">
                                            <p>{translationError}</p>
                                        </div>
                                    )}
                                    {!isTranslating && !translationError && !translatedText && (
                                        <div className="text-gray-500 flex items-center justify-center h-full">
                                            <p>Your translation will appear here.</p>
                                        </div>
                                    )}
                                    {translatedText && (
                                        <p className="text-gray-200 whitespace-pre-wrap font-mono text-sm">{translatedText}</p>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </main>
            </div>
        </div>
    );
};

export default App;
