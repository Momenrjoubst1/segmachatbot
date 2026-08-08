import anthropicSvg from "./anthropic.svg";

type AnthropicIconProps = {
  className?: string;
};

export const AnthropicIcon = ({ className }: AnthropicIconProps) => (
  <img
    src={anthropicSvg}
    alt=""
    aria-hidden="true"
    className={className}
  />
);