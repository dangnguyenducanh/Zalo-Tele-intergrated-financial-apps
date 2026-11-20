import CardGiftcardIcon from '@mui/icons-material/CardGiftcard';
import CategoryIcon from '@mui/icons-material/Category';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import HomeIcon from '@mui/icons-material/Home';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import MovieIcon from '@mui/icons-material/Movie';
import PaymentsIcon from '@mui/icons-material/Payments';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import SavingsIcon from '@mui/icons-material/Savings';
import SchoolIcon from '@mui/icons-material/School';
import ShoppingBagIcon from '@mui/icons-material/ShoppingBag';

// Categories store a Material icon name (server/src/seed/templates.js). These are the names the
// default templates use, which is also the list the category dialog offers. Unknown names show "Category".
export const CATEGORY_ICONS = {
  Restaurant: RestaurantIcon,
  DirectionsCar: DirectionsCarIcon,
  ShoppingBag: ShoppingBagIcon,
  ReceiptLong: ReceiptLongIcon,
  Home: HomeIcon,
  Movie: MovieIcon,
  LocalHospital: LocalHospitalIcon,
  School: SchoolIcon,
  Category: CategoryIcon,
  Payments: PaymentsIcon,
  EmojiEvents: EmojiEventsIcon,
  CardGiftcard: CardGiftcardIcon,
  Savings: SavingsIcon,
};

export type CategoryIconName = keyof typeof CATEGORY_ICONS;
export const ICON_NAMES = Object.keys(CATEGORY_ICONS) as CategoryIconName[];
export const DEFAULT_ICON: CategoryIconName = 'Category';
export const DEFAULT_COLOR = '#757575';

export const iconOf = (name: string) => CATEGORY_ICONS[name as CategoryIconName] ?? CategoryIcon;
