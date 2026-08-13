import { useState } from 'react';
import { submitFeedback } from '../services/api';

export function useFeedback() {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSent, setFeedbackSent] = useState(false);

  const submit = async () => {
    if (!feedbackText.trim()) return;
    try {
      await submitFeedback({ content: feedbackText });
      setFeedbackSent(true);
      setTimeout(() => {
        setFeedbackSent(false);
        setFeedbackOpen(false);
        setFeedbackText('');
      }, 3000);
    } catch {
      setFeedbackSent(true);
    }
  };

  const cancel = () => setFeedbackOpen(false);
  const open = () => setFeedbackOpen(true);

  return {
    feedbackOpen, feedbackText, feedbackSent,
    setFeedbackText, open, cancel, submit,
  };
}
