import { AnimatedThemeToggler } from "../animated-theme-toggler";

export function ThemeToggle() {
    return (
        <div className="text-primary">
            <AnimatedThemeToggler sound={true} />
        </div>
    );
}

