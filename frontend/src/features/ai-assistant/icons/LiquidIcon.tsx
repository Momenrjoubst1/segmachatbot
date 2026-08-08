import liquidSvg from "./liquid.svg";

type LiquidIconProps = {
    className?: string;
    alt?: string;
};

export const LiquidIcon = ({
    className,
    alt = "Liquid",
}: LiquidIconProps) => (
    <img
        src={liquidSvg}
        alt={alt}
        className={className}
        draggable={false}
    />
);