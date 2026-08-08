import arceeSvg from "./arcee-color.svg";

type ArceeIconProps = {
    className?: string;
    alt?: string;
};

export const ArceeIcon = ({
    className,
    alt = "Arcee",
}: ArceeIconProps) => (
    <img
        src={arceeSvg}
        alt={alt}
        className={className}
        draggable={false}
    />
);
