import RichText from "./RichText";
import { escapeHtml } from "../lib/format";

// A question's stem under its title in instructor lists, in lighter text for
// reference (issue #223). Renders nothing when there is no stem to show; see
// titleAndStem in lib/questionPrompt.
export default function QuestionStemLine({ stem, className = "" }) {
  if (!stem) return null;
  return (
    <RichText
      as="span"
      text={escapeHtml(stem)}
      className={`block whitespace-pre-line text-xs font-normal text-muted ${className}`}
    />
  );
}
