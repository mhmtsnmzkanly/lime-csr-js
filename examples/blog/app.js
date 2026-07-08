import { createStore, mount, setDevMode } from '../../src/index.js';

const root = document.getElementById('app');
let nextTopLevelCommentId = 104;
let nextReplyId = 204;

function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '?')
    .join('');
}

function makeAvatarUrl(name, tint) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="${name}">
    <rect width="96" height="96" rx="48" fill="#${tint}"/>
    <text x="48" y="56" text-anchor="middle" font-family="Georgia, serif" font-size="30" font-weight="700" fill="#fff">${initials(name)}</text>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function likeStatusText(liked, count) {
  const countLabel = `${count} beğeni`;
  return liked ? `${countLabel} · Beğenildi. Kaldırmak için tıkla.` : `${countLabel}. Beğenmek için tıkla.`;
}

/**
 * "Decorates" a comment by precomputing its reactive field paths (likedPath,
 * repliesPath, ...). Without knowing its real location (path) in the store,
 * a comment cannot reactively bind its own like/reply state.
 */
function decorateComment(comment, path) {
  const likedPath = `${path}.liked`;
  const likeCountPath = `${path}.likeCount`;
  const stateClassPath = `${path}.likeStateClass`;
  const statusPath = `${path}.likeStatus`;
  const repliesPath = `${path}.replies`;
  const replyCountPath = `${path}.replyCount`;
  const replies = Array.isArray(comment.replies) ? comment.replies : [];

  return {
    ...comment,
    path,
    likedPath,
    likeCountPath,
    likeStateClass: comment.liked ? 'is-active' : '',
    stateClassPath,
    likeStatus: likeStatusText(comment.liked, comment.likeCount),
    statusPath,
    repliesPath,
    replyCount: replies.length,
    replyCountPath,
    likeButton: {
      action: 'toggle-comment-like',
      targetId: comment.id,
      likedPath,
      countPath: likeCountPath,
      stateClassPath,
      statusPath,
    },
    author: { ...comment.author },
    replies: replies.map((reply, index) => decorateComment(reply, `${repliesPath}.${index}`)),
  };
}

function buildInitialState() {
  const author = {
    name: 'Deniz Aksoy',
    bio: 'Kahve kavurmacısı; sekiz yıldır ev demlemesi ekipmanı ve tarifleri üzerine yazıyor.',
    avatarUrl: makeAvatarUrl('Deniz Aksoy', '5c3a21'),
    verified: true,
    website: 'https://denizaksoy.coffee',
    publishedAt: '2026-06-20',
    dateLabel: '20 Haziran 2026',
  };

  const post = {
    title: 'V60 ile Evde Filtre Kahve: Adım Adım Bir Rehber',
    kicker: 'Demleme Rehberi',
    subtitle:
      'Doğru öğütüm, doğru su sıcaklığı ve sabırlı bir dökme tekniğiyle, ilk demlemenden itibaren fark edeceğin bir sonuç.',
    heroUrl:
      'data:image/svg+xml;charset=UTF-8,' +
      encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="420">
        <rect width="960" height="420" fill="#e9d9c4"/>
        <circle cx="230" cy="230" r="150" fill="#7a4e2b" opacity="0.18"/>
        <circle cx="760" cy="140" r="90" fill="#c18b5b" opacity="0.28"/>
        <rect x="360" y="120" width="240" height="240" rx="24" fill="#fffaf2" opacity="0.6"/>
      </svg>`),
    heroAlt: 'Ahşap masada V60 dripper, cam sürahi ve taze öğütülmüş kahve',
    featured: true,
    author,
    category: { label: 'Kahve Rehberi', slug: 'kahve-rehberi' },
    bodyIntro:
      'V60, ev demlemesine yeni başlayanların da elinde çabucak tutarlı sonuçlar verebilen, açık uçlu bir huni. ' +
      'Ama "tutarlı" kelimesi anahtar: aynı kahveyi her seferinde aynı şekilde demlemek, çoğu kişinin atladığı bir adımdan geçiyor — tartım.',
    bodyMethod:
      'Başlangıç oranı olarak 1:16 (15 g kahve, 240 g su) iyi bir referans noktası. Suyu 92-94°C aralığında tutun; ' +
      'kahve orta-ince öğütülmeli, deniz tuzu tanesi kalınlığında. İlk 30 saniyeyi "blooming" için ayırın — kahvenin ' +
      'gazını çıkarması, sonraki dökümlerin daha dengeli ekstrakte olmasını sağlar.',
    bodyClosing:
      'Toplam demleme süresi 2:30-3:00 dakika arasında kalmalı. Daha uzun sürüyorsa öğütümü kabalaştırın; ' +
      'daha kısa sürüyorsa inceltin. Not tutmak, üçüncü demlemenden itibaren fark yaratır.',
    tags: [
      { slug: 'v60', label: 'V60' },
      { slug: 'filtre-kahve', label: 'Filtre Kahve' },
      { slug: 'demleme-rehberi', label: 'Demleme Rehberi' },
      { slug: 'ekipman', label: 'Ekipman' },
    ],
    liked: false,
    likeCount: 128,
    likedPath: 'post.liked',
    likeCountPath: 'post.likeCount',
    likeStateClass: '',
    stateClassPath: 'post.likeStateClass',
    likeStatus: likeStatusText(false, 128),
    statusPath: 'post.likeStatus',
  };
  post.tagCount = post.tags.length;
  post.postLikeButton = {
    action: 'toggle-post-like',
    targetId: 'post-1',
    likedPath: post.likedPath,
    countPath: post.likeCountPath,
    stateClassPath: post.stateClassPath,
    statusPath: post.statusPath,
  };

  const baseComments = [
    {
      id: 'c-101',
      body: 'Blooming adımını atladığımı fark ettim, gerçekten fark yaratıyor. 30 saniye sabretmek zor geliyordu ama sonuç çok daha dengeli.',
      liked: false,
      likeCount: 6,
      author: {
        name: 'Mert Şahin',
        avatarUrl: makeAvatarUrl('Mert Şahin', '8c5a3c'),
        isAdmin: false,
      },
      publishedAt: '2026-06-21',
      dateLabel: '21 Haziran 2026',
      replies: [
        {
          id: 'r-201',
          body: 'Blooming zamanını su sıcaklığına göre de ayarlayabilirsin — daha sıcak suda 25 saniye bile yeterli olabiliyor.',
          liked: true,
          likeCount: 9,
          author: {
            name: 'Deniz Aksoy',
            avatarUrl: makeAvatarUrl('Deniz Aksoy', '5c3a21'),
            isAdmin: true,
          },
          publishedAt: '2026-06-21',
          dateLabel: '21 Haziran 2026',
          replies: [
            {
              id: 'r2-301',
              body: 'Bunu denedim, 26 saniyede güzel bir sonuç aldım. Teşekkürler!',
              liked: false,
              likeCount: 2,
              author: {
                name: 'Mert Şahin',
                avatarUrl: makeAvatarUrl('Mert Şahin', '8c5a3c'),
                isAdmin: false,
              },
              publishedAt: '2026-06-22',
              dateLabel: '22 Haziran 2026',
              replies: [],
            },
          ],
        },
      ],
    },
    {
      id: 'c-102',
      body: '1:16 oranı benim damak zevkime biraz sulu geldi, 1:15 ile devam ediyorum. Herkesin damağı farklı sanırım.',
      liked: true,
      likeCount: 11,
      author: {
        name: 'Selin Kaya',
        avatarUrl: makeAvatarUrl('Selin Kaya', '6f4a26'),
        isAdmin: false,
      },
      publishedAt: '2026-06-20',
      dateLabel: '20 Haziran 2026',
      replies: [
        {
          id: 'r-202',
          body: 'Kesinlikle — oran bir başlangıç noktası, kavurma koyulaştıkça ben de oranı sıkılaştırıyorum.',
          liked: false,
          likeCount: 3,
          author: {
            name: 'Deniz Aksoy',
            avatarUrl: makeAvatarUrl('Deniz Aksoy', '5c3a21'),
            isAdmin: true,
          },
          publishedAt: '2026-06-20',
          dateLabel: '20 Haziran 2026',
          replies: [],
        },
      ],
    },
    {
      id: 'c-103',
      body: 'Öğütücü olarak elle çekim mi elektrikli mi önerirsin, bütçe sınırlıysa?',
      liked: false,
      likeCount: 1,
      author: {
        name: 'İpek Demir',
        avatarUrl: makeAvatarUrl('İpek Demir', '8a5a32'),
        isAdmin: false,
      },
      publishedAt: '2026-06-19',
      dateLabel: '19 Haziran 2026',
      replies: [],
    },
  ];

  const comments = baseComments.map((comment, index) => decorateComment(comment, `comments.${index}`));

  return {
    session: {
      loggedIn: true,
      user: {
        // A root-relative path: the avatar in the nav is bound reactively via
        // {x}/data-x, and bindings.js's URL whitelist only allows http(s)/
        // root-relative/#anchor — data: URIs (like the ${}-static SVGs used
        // for author/comment avatars) are deliberately rejected in a
        // reactive src binding.
        name: 'Elif Kaya',
        avatarUrl: '/avatars/elif-kaya.svg',
        isAdmin: false,
      },
    },
    post,
    comments,
    commentCount: comments.length,
    similarPosts: [
      {
        title: 'Chemex ile Yavaş Demleme: Ne Zaman Tercih Etmeli?',
        href: '/chemex-ile-yavas-demleme',
        excerpt: 'V60 ile Chemex arasındaki fark yalnızca filtre kalınlığı değil — akış hızı tüm profili değiştiriyor.',
      },
      {
        title: 'Kahve Çekirdeği Seçerken Nelere Dikkat Etmeli?',
        href: '/kahve-cekirdegi-secimi',
        excerpt: 'Kavurma tarihini, rakım bilgisini ve işleme yöntemini okumayı öğrenmek, demlemeden önce gelir.',
      },
      {
        title: 'Su Sıcaklığı Neden Bu Kadar Önemli?',
        href: '/su-sicakligi-neden-onemli',
        excerpt: 'Kaynar suyla demlenen kahve neden acılaşır? Ekstraksiyon kimyasına kısa bir bakış.',
      },
    ],
    draftText: '',
    replyTargetId: null,
    replyTargetLabel: '',
  };
}

const store = createStore(buildInitialState());
setDevMode(true);

// A real use of store.subscribe(): update the tab title as the comment count
// changes — a legitimate example of application code subscribing to the
// store directly, outside of bindings.js.
store.subscribe('commentCount', (count) => {
  document.title = `(${count}) Filtre Kahve Günlüğü — V60 ile evde demleme`;
});
document.title = `(${store.get('commentCount')}) Filtre Kahve Günlüğü — V60 ile evde demleme`;

function cloneComment(comment) {
  return {
    ...comment,
    author: { ...comment.author },
    replies: Array.isArray(comment.replies) ? comment.replies.map(cloneComment) : [],
  };
}

function findCommentById(comments, id) {
  for (const comment of comments) {
    if (comment.id === id) return comment;
    const nested = findCommentById(comment.replies || [], id);
    if (nested) return nested;
  }
  return null;
}

/** Strips the path/*Path fields added by decorateComment, making it decoratable again. */
function stripDecoration(comment) {
  return {
    id: comment.id,
    body: comment.body,
    liked: comment.liked,
    likeCount: comment.likeCount,
    author: { ...comment.author },
    publishedAt: comment.publishedAt,
    dateLabel: comment.dateLabel,
    replies: (comment.replies || []).map(stripDecoration),
  };
}

/**
 * Removes the comment with the given id (plain, undecorated) from the tree.
 * Since deletion can shift sibling indices (paths are index-based), the
 * affected branch must be passed back through decorateComment by the caller.
 *
 * @returns {{removed: boolean, parentId: string|null}} parentId: null if the
 *   removed comment was top-level, otherwise the direct parent comment's id.
 */
function removeCommentById(list, id, parentId = null) {
  const idx = list.findIndex((c) => c.id === id);
  if (idx !== -1) {
    list.splice(idx, 1);
    return { removed: true, parentId };
  }
  for (const comment of list) {
    const result = removeCommentById(comment.replies, id, comment.id);
    if (result.removed) return result;
  }
  return { removed: false, parentId: null };
}

function deleteComment(commentId) {
  const plainComments = store.get('comments').map(stripDecoration);
  const { removed, parentId } = removeCommentById(plainComments, commentId);
  if (!removed) return;

  const comments = plainComments.map((c, i) => decorateComment(c, `comments.${i}`));

  // ORDER MATTERS (see the same note in insertReply): the parent comment's
  // repliesPath/replyCountPath must be set BEFORE the enclosing 'comments'
  // set — the store still holds the OLD tree at that point, so Object.is
  // sees a real difference. If the order were reversed (first 'comments',
  // then the path-specific sets), the path-specific sets would already match
  // the new tree and be silently skipped (deleting a reply's LAST child
  // meant the is-gt data-live boundary never fired, leaving the removed node
  // stuck in the DOM — found and fixed).
  if (parentId) {
    const parent = findCommentById(comments, parentId);
    if (parent) {
      store.set(parent.replyCountPath, parent.replyCount);
      store.set(parent.repliesPath, parent.replies);
    }
  }

  store.set('comments', comments);
  store.set('commentCount', comments.length);

  if (store.get('replyTargetId') === commentId) clearReplyTarget();
}

function applyLikeChange(likedPath, countPath, stateClassPath, statusPath, currentLiked, currentCount) {
  const nextLiked = !currentLiked;
  const nextCount = currentCount + (nextLiked ? 1 : -1);
  store.set(likedPath, nextLiked);
  store.set(countPath, nextCount);
  store.set(stateClassPath, nextLiked ? 'is-active' : '');
  store.set(statusPath, likeStatusText(nextLiked, nextCount));
}

function updatePostLike() {
  // store.update(): an example of reading the current value and applying a function to it.
  const liked = store.update('post.liked', (v) => !v);
  const count = store.get('post.likeCount') + (liked ? 1 : -1);
  store.set('post.likeCount', count);
  store.set('post.likeStateClass', liked ? 'is-active' : '');
  store.set('post.likeStatus', likeStatusText(liked, count));
}

function updateCommentLike(commentId) {
  const comment = findCommentById(store.get('comments'), commentId);
  if (!comment) return;
  applyLikeChange(
    comment.likedPath,
    comment.likeCountPath,
    comment.stateClassPath,
    comment.statusPath,
    comment.liked,
    comment.likeCount,
  );
}

function insertTopLevelComment(body) {
  const comments = store.get('comments').map(cloneComment);
  const index = comments.length;
  const comment = decorateComment(
    {
      id: `c-${nextTopLevelCommentId++}`,
      body,
      liked: false,
      likeCount: 0,
      author: {
        name: store.get('session.user.name'),
        avatarUrl: store.get('session.user.avatarUrl'),
        isAdmin: store.get('session.user.isAdmin'),
      },
      publishedAt: '2026-06-28',
      dateLabel: 'az önce',
      replies: [],
    },
    `comments.${index}`,
  );

  comments.push(comment);
  store.set('comments', comments);
  store.set('commentCount', comments.length);
}

function insertReply(targetId, body) {
  const comments = store.get('comments').map(cloneComment);
  const target = findCommentById(comments, targetId);
  if (!target) return;

  const replyIndex = target.replies.length;
  const reply = decorateComment(
    {
      id: `r-${nextReplyId++}`,
      body,
      liked: false,
      likeCount: 0,
      author: {
        name: store.get('session.user.name'),
        avatarUrl: store.get('session.user.avatarUrl'),
        isAdmin: store.get('session.user.isAdmin'),
      },
      publishedAt: '2026-06-28',
      dateLabel: 'az önce',
      replies: [],
    },
    `${target.repliesPath}.${replyIndex}`,
  );

  const updatedReplies = [...target.replies, reply];
  target.replies = updatedReplies;
  target.replyCount = updatedReplies.length;

  // ORDER MATTERS: the fine-grained paths (replyCountPath/repliesPath) are
  // set FIRST — the store still holds the OLD tree at this point, so
  // Object.is sees a real old/new difference and fires the notification. If
  // the bulk 'comments' set happened FIRST, these path-specific sets made
  // before it would already match the new tree and be silently skipped as
  // "no change" (adding the first reply to a comment with 0 replies meant
  // the is-gt data-live boundary never fired, leaving the "no replies yet"
  // message stuck — found and fixed).
  store.set(target.replyCountPath, updatedReplies.length);
  store.set(target.repliesPath, updatedReplies.slice());
  store.set('comments', comments);
  store.set('draftText', '');
  store.set('replyTargetId', null);
  store.set('replyTargetLabel', '');
}

function setReplyTarget(commentId) {
  const comment = findCommentById(store.get('comments'), commentId);
  if (!comment) return;
  store.set('replyTargetId', comment.id);
  store.set('replyTargetLabel', comment.author.name);
}

function clearReplyTarget() {
  store.set('replyTargetId', null);
  store.set('replyTargetLabel', '');
}

function getComposer() {
  return root.querySelector('#comment-draft');
}

function syncComposerValue() {
  const composer = getComposer();
  if (composer) composer.value = store.get('draftText') || '';
}

function handleAction(action, event) {
  const targetId = event.target.closest('[data-comment-id]')?.getAttribute('data-comment-id') || null;

  switch (action) {
    case 'toggle-post-like':
      updatePostLike();
      break;
    case 'toggle-comment-like':
      if (targetId) updateCommentLike(targetId);
      break;
    case 'reply-to':
      if (targetId) setReplyTarget(targetId);
      break;
    case 'delete-comment':
      if (targetId) deleteComment(targetId);
      break;
    case 'cancel-reply':
      clearReplyTarget();
      break;
    case 'add-comment': {
      const draft = (store.get('draftText') || '').trim();
      if (!draft) return;
      const replyTargetId = store.get('replyTargetId');
      if (replyTargetId) {
        insertReply(replyTargetId, draft);
      } else {
        insertTopLevelComment(draft);
      }
      syncComposerValue();
      break;
    }
    case 'filter-by-tag':
      // There's no real filter page in this demo; it's enough to show that
      // the tag is clickable and that the data-action pattern also works
      // inside partial content.
      break;
    default:
      break;
  }
}

function initComposerListeners() {
  const composer = getComposer();
  if (!composer) return;

  composer.value = store.get('draftText') || '';

  composer.addEventListener('input', (event) => {
    store.set('draftText', event.currentTarget.value);
  });
}

function initActions() {
  root.addEventListener('click', (event) => {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl || !root.contains(actionEl)) return;
    const action = actionEl.getAttribute('data-action');
    handleAction(action, event);
  });
}

mount('page', store.get(), root, store);
initComposerListeners();
initActions();

window.coffeeBlog = {
  store,
  updatePostLike,
  updateCommentLike,
  insertTopLevelComment,
  insertReply,
  deleteComment,
  setReplyTarget,
  clearReplyTarget,
};
