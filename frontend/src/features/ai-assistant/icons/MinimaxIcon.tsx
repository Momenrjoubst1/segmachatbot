import minimaxSvg from "./minimax-color.svg";

type MinimaxIconProps = {
    className?: string;
    alt?: string;
};

export const MinimaxIcon = ({
    className,
    alt = "Minimax",
}: MinimaxIconProps) => (
    <img
        src={minimaxSvg}
        alt={alt}
        className={className}
        draggable={false}
    />
);
