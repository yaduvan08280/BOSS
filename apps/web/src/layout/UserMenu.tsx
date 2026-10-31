import { Bot, CircleHelp, Languages, LogOut, Monitor, Moon, Sun, Type, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { Language, Me, ThemeMode } from '@mono/shared';
import { Avatar } from '@/components/brand';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLargeText } from './useLargeText';

type Props = {
  me: Me;
  onLanguage: (lang: Language) => void;
  onTheme: (mode: ThemeMode) => void;
  onAssistant: () => void;
  onSignOut: () => void;
};

export function UserMenu({ me, onLanguage, onTheme, onAssistant, onSignOut }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [largeText, setLargeText] = useLargeText();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full outline-offset-2" aria-label={t('shell.profile')}>
        <Avatar name={me.user.name} url={me.user.avatarUrl} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-foreground">
          <div className="text-sm font-semibold">{me.user.name}</div>
          <div className="text-xs font-normal text-muted-foreground">
            {me.user.code} · {me.user.roleName}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/account')}>
          <UserRound /> {t('shell.profile')}
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Languages /> {t('shell.language')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={me.user.lang} onValueChange={(v) => onLanguage(v as Language)}>
              <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="hi">हिंदी</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {me.user.themeMode === 'dark' ? <Moon /> : me.user.themeMode === 'light' ? <Sun /> : <Monitor />}
            {t('shell.appearance')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={me.user.themeMode} onValueChange={(v) => onTheme(v as ThemeMode)}>
              <DropdownMenuRadioItem value="light">{t('shell.light')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">{t('shell.dark')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">{t('shell.system')}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={largeText} onCheckedChange={(v) => setLargeText(Boolean(v))}>
              <Type /> {t('shell.largerText')}
            </DropdownMenuCheckboxItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onSelect={onAssistant}>
          <Bot /> {t('shell.assistant')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/support')}>
          <CircleHelp /> {t('shell.help')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut}>
          <LogOut /> {t('shell.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
