import numpy as np
from skimage.metrics import structural_similarity as ssim
import cv2
from argparse import ArgumentParser
import json
import pickle 
import sys 

FEATURES_PATH = "features.pkl" 
CIDMAP_PATH = "cidmap.json"

class ImageSimilarityDetector:
    def __init__(self):
        self.feature_detector = cv2.SIFT_create()
        self.matcher_type = 'FLANN'

    def load_and_preprocess(self, img_path, target_size=(256, 256)):
        """
        Loads an image, applies median blur for noise reduction, and resizes it.
        Returns the original image (for potential SSIM/MSE if needed) and the resized image.
        """
        try:
            img = cv2.imread(img_path)
            if img is None:
                raise ValueError(f"Cannot load image: {img_path}")
            kernel_size = 7 
            img_blurred = cv2.medianBlur(img, kernel_size)
            img_resized = cv2.resize(img_blurred, target_size, interpolation=cv2.INTER_AREA)
            return img, img_resized # Return original and resized
        except Exception as e:
            print(json.dumps({"error": f"Error loading or preprocessing image {img_path}: {e}"}), file=sys.stderr)
            return None, None

    def calculate_features(self, img_path, target_size=(256, 256), hash_size=8):
        """
        Calculates various perceptual and structural features for an image.
        Returns a dictionary of features.
        """
        img_orig, img_resized = self.load_and_preprocess(img_path, target_size)
        if img_resized is None: # load_and_preprocess returns None on failure
            return None

        gray_resized = cv2.cvtColor(img_resized, cv2.COLOR_BGR2GRAY)
        hsv_resized = cv2.cvtColor(img_resized, cv2.COLOR_BGR2HSV)

        kp, des = self.feature_detector.detectAndCompute(gray_resized, mask=None)
        
        if des is None:
            des = np.array([]) 
        if kp is None:
            kp_count = 0
        else:
            kp_count = len(kp) 

        features = {
            'phash': self.calculate_perceptual_hash(img_resized, hash_size),
            'dhash': self.calculate_dhash(img_resized, hash_size),
            'ahash': self.calculate_average_hash(img_resized, hash_size),
            'rot_hash': self.calculate_rotation_invariant_hash(img_resized, hash_size),
            'hu_moments': self.calculate_hu_moments(img_resized), 
            'histogram': cv2.calcHist([hsv_resized], [0, 1, 2], None, [50, 60, 60], [0, 180, 0, 256, 0, 256]), 
            'keypoint_count': kp_count,
            'descriptors': des 
        }
        return features

    def compare_image_features(self, features1, features2, quick_mode=False):
        """
        Compares two sets of image features and returns similarity scores.
        Can operate in quick_mode for faster approximate comparison.
        """
        quick_results = {
            'perceptual_hash_similarity': self.hash_similarity(features1['phash'], features2['phash']),
            'differential_hash_similarity': self.hash_similarity(features1['dhash'], features2['dhash']),
            'average_hash_similarity': self.hash_similarity(features1['ahash'], features2['ahash']),
            'hu_moments_similarity': self.compare_hu_moments(features1['hu_moments'], features2['hu_moments']),
            'rotation_invariant_hash_similarity': self.hash_similarity(features1['rot_hash'], features2['rot_hash'])
        }
        for key in quick_results:
            quick_results[key] = float(quick_results[key])
        quick_results['quick_average'] = float(np.mean(list(quick_results.values())))
        similarity_score_for_conclusion = quick_results['quick_average'] 
        if similarity_score_for_conclusion > 0.9:
            quick_conclusion = "Very similar"
        elif similarity_score_for_conclusion > 0.8:
            quick_conclusion = "Some similarity"
        else:
            quick_conclusion = "Significant difference"

        if quick_mode:
            return {
                'quick_results': quick_results,
                'quick_conclusion': quick_conclusion,
                'mode': 'quick'
            }
        hist_similarity = max(cv2.compareHist(features1['histogram'], features2['histogram'], cv2.HISTCMP_CORREL), 0)
        feature_similarity, good_matches = self.compare_descriptors(
            features1['descriptors'], features2['descriptors'],
            features1['keypoint_count'], features2['keypoint_count']
        )
        all_similarities = list(quick_results.values()) + [hist_similarity, feature_similarity]
        avg_similarity = float(np.mean(all_similarities)) # Ensure float
        final_similarity = avg_similarity 
        if final_similarity > 0.85:
            conclusion = "Very similar"
        elif final_similarity > 0.7:
            conclusion = "Some similarity"
        else:
            conclusion = "Significant difference"

        return {
            'quick_results': quick_results,
            'histogram_similarity': float(hist_similarity),
            'feature_similarity': float(feature_similarity),
            'good_matches': int(good_matches), # Ensure integer
            'average_similarity': float(avg_similarity),
            'final_similarity': float(final_similarity),
            'quick_conclusion': quick_conclusion,
            'final_conclusion': conclusion,
            'mode': 'full'
        }

    def calculate_ssim(self, img1, img2):
        gray1 = cv2.cvtColor(img1, cv2.COLOR_BGR2GRAY)
        gray2 = cv2.cvtColor(img2, cv2.COLOR_BGR2GRAY)
        similarity_index, _ = ssim(gray1, gray2, full=True)
        return similarity_index

    def calculate_mse(self, img1, img2):
        return np.mean((img1.astype(float) - img2.astype(float)) ** 2)
    
    def calculate_perceptual_hash(self, img, hash_size=8):
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        resized = cv2.resize(gray, (hash_size, hash_size), interpolation=cv2.INTER_AREA)
        avg = resized.mean()
        return ''.join(['1' if bit else '0' for bit in (resized > avg).flatten()])

    def calculate_dhash(self, img, hash_size=8):
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        # Resize to (hash_size + 1, hash_size) for differential hashing
        resized = cv2.resize(gray, (hash_size + 1, hash_size), interpolation=cv2.INTER_AREA)
        diff = resized[:, 1:] > resized[:, :-1] # Compare adjacent pixels
        return ''.join(['1' if bit else '0' for bit in diff.flatten()])

    def calculate_average_hash(self, img, hash_size=8):
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        resized = cv2.resize(gray, (hash_size, hash_size), interpolation=cv2.INTER_AREA)
        avg = resized.mean()
        return ''.join(['1' if bit else '0' for bit in (resized > avg).flatten()])
    
    def calculate_rotation_invariant_hash(self, img, hash_size=8):
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        resized = cv2.resize(gray, (hash_size * 2, hash_size * 2), interpolation=cv2.INTER_AREA)
        center = (hash_size, hash_size) # Center of the resized image
        radial_features = []
        num_samples = hash_size * 8 
        for angle in range(0, 360, 360 // num_samples): 
            x = int(center[0] + hash_size * 0.8 * np.cos(np.radians(angle)))
            y = int(center[1] + hash_size * 0.8 * np.sin(np.radians(angle)))
            x = max(0, min(x, resized.shape[1] - 1))
            y = max(0, min(y, resized.shape[0] - 1))
            radial_features.append(resized[y, x])
        
        avg = np.mean(radial_features)
        hash_bits = [1 if val > avg else 0 for val in radial_features]
        return ''.join([str(bit) for bit in hash_bits])

    def hamming_distance(self, hash1, hash2):
        if len(hash1) != len(hash2):
            raise ValueError("Hash length mismatch")
        return sum(c1 != c2 for c1, c2 in zip(hash1, hash2))

    def hash_similarity(self, hash1, hash2):
        distance = self.hamming_distance(hash1, hash2)
        return 1 - (distance / len(hash1))

    def calculate_hu_moments(self, img):
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        moments = cv2.moments(gray)
        hu_moments = cv2.HuMoments(moments)
        return -np.sign(hu_moments) * np.log10(np.abs(hu_moments) + 1e-10)

    def compare_hu_moments(self, hu1, hu2):
        distance = np.linalg.norm(hu1 - hu2)
        return 1 / (1 + distance) 

    def compare_descriptors(self, des1, des2, kp_count1, kp_count2):
        """
        Compares SIFT descriptors using FLANN matcher.
        Returns a similarity score based on the ratio of good matches to total keypoints.
        """
        if des1.size == 0 or des2.size == 0 or kp_count1 < 2 or kp_count2 < 2:
            return 0.0, 0 
        FLANN_INDEX_KDTREE = 1
        index_params = dict(algorithm=FLANN_INDEX_KDTREE, trees=5)
        search_params = dict(checks=50) 
        matcher = cv2.FlannBasedMatcher(index_params, search_params)
        matches = matcher.knnMatch(des1, des2, k=2)
        
        good_matches = []
        for match_pair in matches:
            if len(match_pair) == 2: 
                m, n = match_pair
                if m.distance < 0.7 * n.distance: 
                    good_matches.append(m)
        
        total_keypoints = min(kp_count1, kp_count2) 
        similarity = len(good_matches) / total_keypoints if total_keypoints > 0 else 0
        return min(similarity, 1.0), len(good_matches) 

def add_pepper_noise(image_path, amount):
    image = cv2.imread(image_path)
    if image is None:
        print(f"Error: Could not load image from {image_path}")
        return
    output = image.copy()
    num_pepper = int(amount * image.shape[0] * image.shape[1])
    
    for _ in range(num_pepper):
        y = np.random.randint(0, image.shape[0])
        x = np.random.randint(0, image.shape[1])
        if len(image.shape) == 2:
            output[y, x] = 0
        else:
            output[y, x, :] = 0
    cv2.imwrite(f"noise_{amount}_{image_path}", output)


def main():
    parser = ArgumentParser(description="Image Similarity Checker")
    parser.add_argument("img_path", type=str, help="Path to the image for insertion or query")
    parser.add_argument("--insert", action="store_true", help="Run in Insert mode: calculate features and add image if not too similar to existing ones.")
    parser.add_argument("--insert_threshold", type=float, default=0.85, help="Similarity threshold for image insertion. If an image is more similar than this, it won't be inserted.")
    parser.add_argument("--query", action="store_true", help="Run in Query mode: find top N most similar images to the provided image.")
    parser.add_argument("--query_n", type=int, default=5, help="Number of similar images to find in Query mode.")
    parser.add_argument("--query_threshold", type=float, default=0.7, help="Similarity threshold for query mode. Only images more similar than this will be returned.") 

    args = parser.parse_args()

    # Ensure at least one operation mode is selected
    if not args.insert and not args.query:
        print(json.dumps({"error": "Please specify either --insert or --query mode."}), file=sys.stderr)
        parser.print_help(sys.stderr) # Print help to stderr as well
        sys.exit(1)

    # --- INSERT MODE ---
    if args.insert:
        img_path = args.img_path
        features_data = []
        try:
            with open(FEATURES_PATH, 'rb') as feature_file: # Read in binary mode
                features_data = pickle.load(feature_file)
        except (FileNotFoundError, EOFError): # Handle empty or non-existent file
            features_data = []
        except Exception as e:
            print(json.dumps({"error": f"Error loading existing features data from {FEATURES_PATH}: {e}"}, indent=4))
            sys.exit(1)

        detector = ImageSimilarityDetector()
        feature_to_insert = detector.calculate_features(img_path) 
        if feature_to_insert is None:
            print(json.dumps({"error": f"Failed to calculate features for {img_path}. Image might be invalid or corrupted."}, indent=4))
            sys.exit(1)
        
        for existing_img_entry in features_data:
            comparison_result = detector.compare_image_features(existing_img_entry['features'], feature_to_insert, quick_mode=False)
            if comparison_result['final_similarity'] > args.insert_threshold:
                # Optionally, find cid for the existing image
                cidmap_data = {}
                try:
                    with open(CIDMAP_PATH, 'r') as cidmap_file:
                        cidmap_data = json.load(cidmap_file)
                except (FileNotFoundError, json.JSONDecodeError):
                    pass
                existing_img_entry['cid'] = cidmap_data.get(str(existing_img_entry['img_id']), "Unknown CID")

                print(json.dumps({
                    "status": "not_inserted",
                    "reason": "Image too similar to an existing entry.",
                    "img_path": img_path,
                    "existing_img_id": existing_img_entry['img_id'],
                    "existing_img_cid": existing_img_entry.get('cid', "Unknown CID"),
                    "similarity_score": float(comparison_result['final_similarity']) # Ensure float
                }, indent=4))
                sys.exit(0) # Exit successfully, as the operation was handled (not inserted)

        new_img_id = 1
        if features_data:
            new_img_id = max(entry['img_id'] for entry in features_data) + 1

        new_img_entry = {
            'img_id': new_img_id,
            'features': feature_to_insert, # Store the calculated feature dictionary
        }
        features_data.append(new_img_entry)
        
        # Save the updated features data
        try:
            with open(FEATURES_PATH, 'wb') as f: # Write in binary mode
                pickle.dump(features_data, f)
            print(json.dumps({
                "status": "inserted",
                "img_id": new_img_entry['img_id'],
                "img_path": img_path,
                "message": "Image inserted successfully into the database."
            }, indent=4))
        except Exception as e:
            print(json.dumps({"error": f"Error saving features data to {FEATURES_PATH}: {e}"}, indent=4))
            sys.exit(1)

    # --- QUERY MODE ---
    elif args.query: # Only run query if --insert was not specified or if it's the only mode
        img_path = args.img_path
        features_data = []
        try:
            with open(FEATURES_PATH, 'rb') as feature_file: # Read in binary mode
                features_data = pickle.load(feature_file)
        except (FileNotFoundError, EOFError):
            print(json.dumps({"status": "no_results", "message": "No existing features data found. Database is empty."}, indent=4))
            sys.exit(0) # Exit successfully, as no results are expected
        except Exception as e:
            print(json.dumps({"error": f"Error loading existing features data from {FEATURES_PATH}: {e}"}, indent=4))
            sys.exit(1)

        detector = ImageSimilarityDetector()
        query_features = detector.calculate_features(img_path)
        if query_features is None:
            print(json.dumps({"error": f"Failed to calculate features for the query image {img_path}."}, indent=4))
            sys.exit(1)
        
        similarities = []
        for existing_img_entry in features_data:
            comparison_result = detector.compare_image_features(existing_img_entry['features'], query_features, quick_mode=True)
            if comparison_result['quick_results']['quick_average'] >= args.query_threshold:
                similarities.append((existing_img_entry['img_id'], comparison_result['quick_results']['quick_average']))
        
        similarities.sort(key=lambda x: x[1], reverse=True)
        top_n_results = similarities[:args.query_n]
        
        output_results = []
        for img_id, similarity in top_n_results:
            output_results.append({"img_id": img_id, "similarity": float(similarity)}) # Ensure float for JSON

        cidmap_data = {}
        try:
            with open(CIDMAP_PATH, 'r') as cidmap_file:
                cidmap_data = json.load(cidmap_file)
        except (FileNotFoundError, json.JSONDecodeError):
            pass 
            
        for item in output_results:
            item['cid'] = cidmap_data.get(str(item['img_id']), "Unknown CID")
        
        output_results.sort(key=lambda x: x['similarity'], reverse=True)
        print(json.dumps({"status": "success", "results": output_results}, indent=4))

if __name__ == "__main__":
    main()