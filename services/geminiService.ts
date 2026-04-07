
import { GoogleGenAI } from "@google/genai";

if (!process.env.API_KEY) {
  console.warn("API_KEY environment variable not set. Using a placeholder.");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || "YOUR_API_KEY" });

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
        if (typeof reader.result === 'string') {
            resolve(reader.result.split(',')[1]);
        } else {
            reject(new Error("Failed to read file as a data URL."));
        }
    };
    reader.onerror = (error) => reject(error);
  });
};

const vttToPlainText = (vttString: string): string => {
  if (!vttString.trim().startsWith('WEBVTT')) {
    // If it's not a VTT, return the original string, assuming it's plain text.
    return vttString;
  }

  return vttString
    .split('\n')
    .filter(line => 
        !line.trim().startsWith('WEBVTT') &&
        !line.match(/^\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/) &&
        !line.match(/^\d+$/) && // remove cue numbers
        line.trim() !== ''
    )
    .map(line => line.replace(/<[^>]+>/g, '').trim()) // remove VTT tags like <v Speaker 1>
    .join('\n');
};


export const transcribeAudio = async (
    file: File, 
    language: string, 
    identifySpeakers: boolean, 
    generateSubtitles: boolean
): Promise<{ transcription: string; subtitles: string; }> => {
  try {
    const base64Data = await fileToBase64(file);
    
    const audioPart = {
      inlineData: {
        data: base64Data,
        mimeType: file.type,
      },
    };

    let prompt = '';
    
    if (generateSubtitles) {
        if (identifySpeakers) {
            prompt = `Please transcribe the audio. The language spoken is ${language}. The audio contains multiple speakers. It is crucial that you differentiate between each speaker. Provide the output in WebVTT (VTT) format, starting with the "WEBVTT" header. Use VTT voice tags (e.g., <v Speaker 1>) to label speakers within the captions. It must contain accurate timestamps. Do not include any other text, explanations, or markdown formatting around the VTT content. The output must be a valid VTT file content.`;
        } else {
            prompt = `Please transcribe the audio. The language spoken is ${language}. Provide the output in WebVTT (VTT) format, starting with the "WEBVTT" header. It should contain accurate timestamps and captions. Do not include any other text, explanations, or markdown formatting around the VTT content. The output must be a valid VTT file content.`;
        }
    } else {
        if (identifySpeakers) {
            prompt = `Please transcribe the audio. The language spoken is ${language}. The audio contains multiple speakers. It is crucial that you differentiate between each speaker. Label each speaker turn with a unique identifier (e.g., Speaker 1, Speaker 2, Speaker 3, etc.). Provide only the raw text.`;
        } else {
            prompt = `Transcribe the audio from the provided file. The language spoken in the audio is ${language}. Provide only the raw text of the transcription. Do not include any headers, titles, or introductory phrases like "Here is the transcription:". Just return the transcribed text directly.`;
        }
    }
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ parts: [audioPart, { text: prompt }] }],
    });

    const text = response.text;

    if (text) {
        const trimmedText = text.trim();
        if (generateSubtitles) {
            const plainText = vttToPlainText(trimmedText);
            return { transcription: plainText, subtitles: trimmedText };
        } else {
            return { transcription: trimmedText, subtitles: '' };
        }
    } else {
      const candidate = response.candidates?.[0];
      if(candidate?.finishReason && candidate.finishReason !== 'STOP') {
         return { transcription: `Error: Transcription stopped due to ${candidate.finishReason}. Check safety settings or content policy.`, subtitles: '' };
      }
      return { transcription: "Error: The API returned an empty transcription. The audio might be silent or in an unsupported format.", subtitles: '' };
    }
  } catch (error) {
    console.error("Error transcribing audio:", error);
    const errorMessage = error instanceof Error ? `Error: ${error.message}` : "Error: An unknown error occurred during transcription.";
    return { transcription: errorMessage, subtitles: '' };
  }
};

export const translateText = async (text: string, targetLanguage: string, isVtt: boolean = false): Promise<string> => {
  try {
    const prompt = isVtt
      ? `Translate the caption text in the following WebVTT content to ${targetLanguage}. It is crucial to preserve the original timestamps, speaker tags (e.g., <v Speaker 1>), and the overall VTT structure (including the WEBVTT header). Only translate the text spoken by the speakers. Do not add any extra explanation, headers, or markdown formatting. Provide only the raw, translated VTT content.\n\nWEBVTT content to translate:\n"""\n${text}\n"""`
      : `Translate the following text to ${targetLanguage}. Do not add any extra explanation, headers, or markdown formatting. Provide only the raw translated text.\n\nText to translate:\n"""\n${text}\n"""`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ parts: [{ text: prompt }] }],
    });

    const translated = response.text;
    if (translated) {
        const candidate = response.candidates?.[0];
        if(candidate?.finishReason && candidate.finishReason !== 'STOP') {
            return `Error: Translation stopped due to ${candidate.finishReason}.`;
        }
        return translated.trim();
    } else {
        return "Error: The API returned an empty translation.";
    }
  } catch (error) {
    console.error("Error translating text:", error);
    const errorMessage = error instanceof Error ? `Error: ${error.message}` : "Error: An unknown error occurred during translation.";
    return errorMessage;
  }
};
